export type PageType = "article" | "form" | "product" | "editor" | "search" | "other";

export type VisibleTextSource = "h1" | "p" | "li" | "label" | "other";

export type VisibleTextChunk = {
  id: string;
  text: string;
  source: VisibleTextSource;
};

export type ActiveElementSummary = {
  kind: "input" | "textarea" | "contenteditable" | "select";
  label: string;
  input_type?: string;
  value_length?: number;
};

export type FormFieldSummary = {
  field_id: string;
  label: string;
  kind: "input" | "textarea" | "select";
  input_type?: string;
  required?: boolean;
  is_sensitive: boolean;
  answered: boolean;
};

export type ContextSnapshot = {
  session_id: string;
  url: string;
  domain: string;
  page_type: PageType;
  page_title: string;
  visible_text_chunks: VisibleTextChunk[];
  active_element: ActiveElementSummary | null;
  form_fields: FormFieldSummary[];
  user_actions: Array<Record<string, unknown>>;
  hesitation_score: number;
  tab_cluster_topic?: string;
  timestamp: string;
};

export type UserAction = {
  type: string;
  at: string;
  target?: string;
  details?: string;
};
