type BrowserMode = "http" | "playwright";

type BrowserConfig = {
  mode: BrowserMode;
  timeoutMs: number;
  headless: boolean;
};

type LinkEntry = {
  href: string;
  text: string;
};

type BrowserState = {
  mode: BrowserMode;
  current_url: string | null;
  active_tab_id: number | null;
  open_tabs: number;
  last_extract_text: string | null;
};

export type BrowserActionResult = {
  success: boolean;
  observed_state: string;
  error: string | null;
  state: BrowserState;
  extracted_text?: string;
};

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: "domcontentloaded"; timeout?: number }): Promise<unknown>;
  url(): string;
  evaluate<T>(fn: () => T): Promise<T>;
  keyboard: {
    type(text: string): Promise<void>;
    press(key: string): Promise<void>;
  };
  getByText(text: string): {
    first(): { click(args?: { timeout?: number }): Promise<void> };
  };
  locator(selector: string): {
    evaluateAll<T>(fn: (nodes: Array<{ getAttribute(name: string): string | null; textContent: string | null }>) => T): Promise<T>;
    first(): { click(args?: { timeout?: number }): Promise<void> };
  };
  close(): Promise<void>;
};

type PlaywrightBrowser = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const plain = noScripts.replace(/<[^>]+>/g, " ");
  return normalize(
    plain
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
  );
}

function cleanLinkText(input: string): string {
  return normalize(stripTags(input));
}

export function parseLinksFromHtml(args: { html: string; baseUrl: string }): LinkEntry[] {
  const links: LinkEntry[] = [];
  const regex = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(args.html)) !== null) {
    const hrefRaw = match[1] || match[2] || "";
    if (!hrefRaw.trim()) continue;
    const text = cleanLinkText(match[3] || "");
    if (!text) continue;
    let resolved = hrefRaw.trim();
    try {
      resolved = new URL(resolved, args.baseUrl).toString();
    } catch {
      continue;
    }
    links.push({ href: resolved, text });
  }
  return links;
}

function browserState(args: {
  mode: BrowserMode;
  currentUrl: string | null;
  activeTabId: number | null;
  openTabs: number;
  lastExtractText: string | null;
}): BrowserState {
  return {
    mode: args.mode,
    current_url: args.currentUrl,
    active_tab_id: args.activeTabId,
    open_tabs: args.openTabs,
    last_extract_text: args.lastExtractText
  };
}

function success(args: {
  state: BrowserState;
  observedState: string;
  extractedText?: string;
}): BrowserActionResult {
  return {
    success: true,
    observed_state: args.observedState,
    error: null,
    state: args.state,
    extracted_text: args.extractedText
  };
}

function failure(args: {
  state: BrowserState;
  observedState: string;
  error: string;
}): BrowserActionResult {
  return {
    success: false,
    observed_state: args.observedState,
    error: args.error,
    state: args.state
  };
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ url: string; text: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return {
      url: res.url || url,
      text,
      status: res.status
    };
  } finally {
    clearTimeout(timer);
  }
}

function readConfig(): BrowserConfig {
  const modeRaw = (process.env.AURA_BROWSER_MODE ?? "http").toLowerCase();
  const mode: BrowserMode = modeRaw === "playwright" ? "playwright" : "http";
  const timeoutMs = Number(process.env.AURA_BROWSER_TIMEOUT_MS ?? "15000");
  const headlessRaw = (process.env.AURA_BROWSER_HEADLESS ?? "true").toLowerCase();
  const headless = !["0", "false", "no", "off"].includes(headlessRaw);
  return {
    mode,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 1000 ? Math.floor(timeoutMs) : 15000,
    headless
  };
}

class BrowserController {
  private readonly config: BrowserConfig;
  private currentUrl: string | null = null;
  private currentHtml: string | null = null;
  private lastExtractText: string | null = null;
  private tabCounter = 0;
  private activeTabId: number | null = null;

  private playwrightBrowser: PlaywrightBrowser | null = null;
  private playwrightPage: PlaywrightPage | null = null;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  private state(): BrowserState {
    return browserState({
      mode: this.config.mode,
      currentUrl: this.currentUrl,
      activeTabId: this.activeTabId,
      openTabs: this.tabCounter,
      lastExtractText: this.lastExtractText
    });
  }

  private async initPlaywright(): Promise<void> {
    if (this.playwrightBrowser && this.playwrightPage) return;
    const moduleName = "playwright";
    let playwright: any;
    try {
      playwright = await import(moduleName);
    } catch {
      throw new Error("playwright_unavailable");
    }

    const browser = await playwright.chromium.launch({ headless: this.config.headless });
    this.playwrightBrowser = browser;
    this.playwrightPage = await browser.newPage();
    this.tabCounter = Math.max(this.tabCounter, 1);
    this.activeTabId = 1;
  }

  async newTab(): Promise<BrowserActionResult> {
    try {
      if (this.config.mode === "playwright") {
        await this.initPlaywright();
        const browser = this.playwrightBrowser;
        if (!browser) throw new Error("playwright_not_initialized");
        this.playwrightPage = await browser.newPage();
      }
      this.tabCounter += 1;
      this.activeTabId = this.tabCounter;
      this.currentUrl = null;
      this.currentHtml = null;
      this.lastExtractText = null;
      return success({
        state: this.state(),
        observedState: `new_tab_opened: tab=${this.activeTabId}`
      });
    } catch (error) {
      return failure({
        state: this.state(),
        observedState: "new_tab_failed",
        error: String(error)
      });
    }
  }

  async go(url: string): Promise<BrowserActionResult> {
    if (!url.trim()) {
      return failure({
        state: this.state(),
        observedState: "navigate_failed: empty_url",
        error: "invalid_url"
      });
    }

    try {
      if (this.config.mode === "playwright") {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });
        this.currentUrl = page.url();
        this.currentHtml = await page.evaluate(
          () => (globalThis as any).document?.documentElement?.outerHTML ?? ""
        );
      } else {
        const fetched = await fetchHtml(url, this.config.timeoutMs);
        this.currentUrl = fetched.url;
        this.currentHtml = fetched.text;
        if (fetched.status >= 400) {
          return failure({
            state: this.state(),
            observedState: `navigate_failed: status=${fetched.status} url=${fetched.url}`,
            error: "http_error"
          });
        }
      }
      this.lastExtractText = null;
      return success({
        state: this.state(),
        observedState: `navigated: url=${this.currentUrl ?? "unknown"} ready_state=domcontentloaded`
      });
    } catch (error) {
      return failure({
        state: this.state(),
        observedState: `navigate_failed: url=${url}`,
        error: String(error)
      });
    }
  }

  async search(query: string): Promise<BrowserActionResult> {
    if (!this.currentUrl) {
      return failure({
        state: this.state(),
        observedState: "search_failed: no_active_page",
        error: "no_active_page"
      });
    }
    try {
      if (this.config.mode === "playwright") {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        const selectors = [
          "input[type='search']",
          "input[name='q']",
          "input[aria-label*='search' i]",
          "input[type='text']"
        ];
        let filled = false;
        for (const selector of selectors) {
          try {
            const locator = page.locator(selector).first();
            await locator.click({ timeout: 600 });
            await page.keyboard.type(query);
            await page.keyboard.press("Enter");
            filled = true;
            break;
          } catch {
            // keep trying
          }
        }
        if (!filled) {
          throw new Error("search_input_not_found");
        }
        await page.evaluate(() => (globalThis as any).document?.readyState ?? "unknown");
        this.currentUrl = page.url();
        this.currentHtml = await page.evaluate(
          () => (globalThis as any).document?.documentElement?.outerHTML ?? ""
        );
        return success({
          state: this.state(),
          observedState: `search_submitted: query="${query}" url=${this.currentUrl}`
        });
      }

      const next = new URL(this.currentUrl);
      next.searchParams.set("q", query);
      return this.go(next.toString());
    } catch (error) {
      return failure({
        state: this.state(),
        observedState: `search_failed: query="${query}"`,
        error: String(error)
      });
    }
  }

  async clickResult(index: number): Promise<BrowserActionResult> {
    if (!this.currentUrl || !this.currentHtml) {
      return failure({
        state: this.state(),
        observedState: "click_result_failed: no_active_page",
        error: "no_active_page"
      });
    }
    const normalized = Math.floor(index);
    if (!Number.isFinite(normalized) || normalized < 1) {
      return failure({
        state: this.state(),
        observedState: "click_result_failed: invalid_index",
        error: "invalid_index"
      });
    }

    if (this.config.mode === "playwright") {
      try {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        const selector = `a[href]:nth-of-type(${normalized})`;
        await page.locator(selector).first().click({ timeout: this.config.timeoutMs });
        this.currentUrl = page.url();
        this.currentHtml = await page.evaluate(
          () => (globalThis as any).document?.documentElement?.outerHTML ?? ""
        );
        return success({
          state: this.state(),
          observedState: `clicked_result: index=${normalized} url=${this.currentUrl}`
        });
      } catch (error) {
        return failure({
          state: this.state(),
          observedState: `click_result_failed: index=${normalized}`,
          error: String(error)
        });
      }
    }

    const links = parseLinksFromHtml({ html: this.currentHtml, baseUrl: this.currentUrl });
    const picked = links[normalized - 1];
    if (!picked) {
      return failure({
        state: this.state(),
        observedState: `click_result_failed: index=${normalized} links=${links.length}`,
        error: "result_not_found"
      });
    }
    return this.go(picked.href);
  }

  async clickText(text: string): Promise<BrowserActionResult> {
    if (!text.trim()) {
      return failure({
        state: this.state(),
        observedState: "click_text_failed: empty_text",
        error: "invalid_text"
      });
    }
    if (!this.currentUrl || !this.currentHtml) {
      return failure({
        state: this.state(),
        observedState: "click_text_failed: no_active_page",
        error: "no_active_page"
      });
    }

    if (this.config.mode === "playwright") {
      try {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        await page.getByText(text).first().click({ timeout: this.config.timeoutMs });
        this.currentUrl = page.url();
        this.currentHtml = await page.evaluate(
          () => (globalThis as any).document?.documentElement?.outerHTML ?? ""
        );
        return success({
          state: this.state(),
          observedState: `clicked_text: text="${text}" url=${this.currentUrl}`
        });
      } catch (error) {
        return failure({
          state: this.state(),
          observedState: `click_text_failed: text="${text}"`,
          error: String(error)
        });
      }
    }

    const needle = text.toLowerCase();
    const links = parseLinksFromHtml({ html: this.currentHtml, baseUrl: this.currentUrl });
    const picked = links.find((link) => link.text.toLowerCase().includes(needle));
    if (!picked) {
      return failure({
        state: this.state(),
        observedState: `click_text_failed: text_not_found "${text}"`,
        error: "text_not_found"
      });
    }
    return this.go(picked.href);
  }

  async typeActive(text: string): Promise<BrowserActionResult> {
    if (!text.trim()) {
      return failure({
        state: this.state(),
        observedState: "type_active_failed: empty_text",
        error: "invalid_text"
      });
    }

    if (this.config.mode === "playwright") {
      try {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        await page.keyboard.type(text);
        return success({
          state: this.state(),
          observedState: `typed_active: chars=${text.length}`
        });
      } catch (error) {
        return failure({
          state: this.state(),
          observedState: `type_active_failed: chars=${text.length}`,
          error: String(error)
        });
      }
    }

    return success({
      state: this.state(),
      observedState: `typed_active_simulated: chars=${text.length}`
    });
  }

  async extractText(): Promise<BrowserActionResult> {
    if (!this.currentUrl || !this.currentHtml) {
      return failure({
        state: this.state(),
        observedState: "extract_text_failed: no_active_page",
        error: "no_active_page"
      });
    }

    if (this.config.mode === "playwright") {
      try {
        await this.initPlaywright();
        const page = this.playwrightPage;
        if (!page) throw new Error("playwright_not_initialized");
        const text = await page.evaluate(() =>
          String((globalThis as any).document?.body?.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
        );
        const clipped = text.slice(0, 5000);
        this.lastExtractText = clipped;
        return success({
          state: this.state(),
          observedState: `extract_text_ok: chars=${clipped.length} url=${this.currentUrl}`,
          extractedText: clipped
        });
      } catch (error) {
        return failure({
          state: this.state(),
          observedState: "extract_text_failed",
          error: String(error)
        });
      }
    }

    const text = stripTags(this.currentHtml).slice(0, 5000);
    this.lastExtractText = text;
    return success({
      state: this.state(),
      observedState: `extract_text_ok: chars=${text.length} url=${this.currentUrl}`,
      extractedText: text
    });
  }
}

const singleton = new BrowserController(readConfig());

export async function browserNewTab(): Promise<BrowserActionResult> {
  return singleton.newTab();
}

export async function browserGo(url: string): Promise<BrowserActionResult> {
  return singleton.go(url);
}

export async function browserSearch(query: string): Promise<BrowserActionResult> {
  return singleton.search(query);
}

export async function browserClickResult(index: number): Promise<BrowserActionResult> {
  return singleton.clickResult(index);
}

export async function browserClickText(text: string): Promise<BrowserActionResult> {
  return singleton.clickText(text);
}

export async function browserTypeActive(text: string): Promise<BrowserActionResult> {
  return singleton.typeActive(text);
}

export async function browserExtractText(): Promise<BrowserActionResult> {
  return singleton.extractText();
}
