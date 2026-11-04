export const MAX_TEXT_LENGTH = 2000;

export class TicketApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "TicketApiError";
    this.status = status;
    this.code = code;
  }
}

export function assertText(text: string, emptyMessage: string): string {
  if (!text.trim()) {
    throw new TicketApiError(emptyMessage, 400, "EMPTY_TEXT");
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new TicketApiError(
      `Texto excede ${MAX_TEXT_LENGTH} caracteres`,
      400,
      "TEXT_TOO_LONG",
    );
  }
  return text;
}

type ErrorBody = {
  error?: { code?: string; message?: string };
};

export type TicketClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export class TicketClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TicketClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  me() {
    return this.request<Me>("GET", "/api/me");
  }

  listMyTickets() {
    return this.request<MyTickets>("GET", "/api/tickets");
  }

  getTicket(id: string) {
    return this.request<TicketDetail>("GET", `/api/tickets/${id}`);
  }

  createTicket(body: CreateTicketBody) {
    return this.request<CreatedTicket>("POST", "/api/tickets", body);
  }

  comment(id: string, body: CommentBody) {
    return this.request<CreatedComment>(
      "POST",
      `/api/tickets/${id}/comments`,
      body,
    );
  }

  searchPeople(name: string) {
    const query = new URLSearchParams({ name });
    return this.request<PeopleResult>(
      "GET",
      `/api/erp/users/basic?${query.toString()}`,
    );
  }

  listAdminTickets(filters: AdminTicketQuery) {
    return this.request<AdminTicketPage>(
      "GET",
      `/api/admin/tickets${toQuery(filters)}`,
    );
  }

  updateTicket(id: string, body: UpdateTicketBody) {
    return this.request<UpdatedTicket>(
      "PATCH",
      `/api/admin/tickets/${id}`,
      body,
    );
  }

  listAgents() {
    return this.request<AgentsResult>("GET", "/api/admin/agents");
  }

  async uploadMedia(input: {
    blockId: string;
    mediaType: MediaKind;
    fileName: string;
    mimeType: string;
    data: Buffer;
  }): Promise<{ key: string }> {
    const presign = await this.request<{ uploadUrl: string; key: string }>(
      "POST",
      "/api/media/upload-url",
      {
        blockId: input.blockId,
        mediaType: input.mediaType,
        contentType: input.mimeType,
        contentLength: input.data.length,
        fileName: input.fileName,
      },
    );

    const response = await this.fetchImpl(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType },
      body: new Uint8Array(input.data),
    });

    if (!response.ok) {
      throw new TicketApiError(
        "Falha ao enviar arquivo para o storage",
        response.status,
        "UPLOAD_FAILED",
      );
    }

    return { key: presign.key };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      const error = isErrorBody(payload) ? payload.error : undefined;
      throw new TicketApiError(
        error?.message ?? `HTTP ${response.status}`,
        response.status,
        error?.code ?? "HTTP_ERROR",
      );
    }

    if (!isSuccessBody<T>(payload)) {
      throw new TicketApiError(
        "Resposta sem data",
        response.status,
        "NO_DATA",
      );
    }

    return payload.data;
  }
}

function toQuery(filters: AdminTicketQuery): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  return Boolean(value && typeof value === "object" && "error" in value);
}

function isSuccessBody<T>(value: unknown): value is { data: T } {
  return Boolean(value && typeof value === "object" && "data" in value);
}

export type Me = {
  id: string;
  name: string;
  email: string;
  role: "requester" | "agent";
};

export type PersonRef = { name: string; initials?: string; id?: string };

export type MyTicket = {
  id: string;
  protocol: string;
  type: string;
  status: string;
  subject: string;
  createdAt: string;
  assignee: PersonRef | null;
};

export type MyTickets = {
  tickets: MyTicket[];
  stats: Record<string, number>;
};

export type ContentBlock =
  | { id?: string; type: "text"; content: string }
  | { id?: string; type: string; url?: string; fileName?: string };

export type TicketComment = {
  id: string;
  content: string;
  createdAt: string;
  author: { id?: string; name: string; role: string; initials?: string };
  blocks?: ContentBlock[];
};

export type TicketEvent = {
  id?: string;
  type?: string;
  title: string;
  description: string;
  createdAt: string;
};

export type TicketDetail = {
  id: string;
  protocol: string;
  type: string;
  status: string;
  priority?: string | null;
  subject: string;
  createdAt: string;
  requester?: PersonRef;
  assignee: PersonRef | null;
  relatedPeople?: { id: string; name: string }[];
  blocks?: ContentBlock[];
  comments?: TicketComment[];
  events?: TicketEvent[];
  githubIssueUrl?: string | null;
  gitBranch?: string | null;
};

export type RelatedPerson = { id: string; name: string };

export type MediaKind = "image" | "video" | "audio" | "attachment";

export type SubmittedBlock =
  | { id: string; type: "text"; content: string }
  | {
      id: string;
      type: "image" | "video";
      mediaKey: string;
      mediaMime: string;
      mediaSizeBytes: number;
    }
  | {
      id: string;
      type: "audio";
      mediaKey: string;
      mediaMime: string;
      mediaSizeBytes: number;
    }
  | {
      id: string;
      type: "attachment";
      mediaKey: string;
      mediaMime: string;
      mediaSizeBytes: number;
      fileName: string;
    };

export type CreateTicketBody = {
  type: string;
  blocks: SubmittedBlock[];
  relatedPeople?: RelatedPerson[];
};

export type CreatedTicket = {
  id: string;
  protocol: string;
  type: string;
  status: string;
  subject: string;
  createdAt: string;
};

export type CommentBody = {
  blocks: SubmittedBlock[];
};

export type CreatedComment = {
  id: string;
  content: string;
  createdAt: string;
};

export type PeopleResult = { users: RelatedPerson[] };

export type AdminTicket = {
  id: string;
  protocol: string;
  type: string;
  status: string;
  priority: string | null;
  subject: string;
  createdAt: string;
  requester: PersonRef;
  assignee: PersonRef | null;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
};

export type AdminTicketPage = {
  tickets: AdminTicket[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminTicketQuery = {
  q?: string;
  requester?: string;
  assigneeId?: string;
  priority?: string;
  type?: string;
  status?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export type UpdateTicketBody = {
  status?: string;
  priority?: string | null;
  assigneeId?: string | null;
  gitBranch?: string | null;
};

export type UpdatedTicket = {
  id: string;
  status: string;
  priority: string | null;
  assigneeId: string | null;
  gitBranch: string | null;
};

export type Agent = {
  id: string;
  name: string;
  initials: string;
  githubUsername?: string | null;
};

export type AgentsResult = { agents: Agent[] };
