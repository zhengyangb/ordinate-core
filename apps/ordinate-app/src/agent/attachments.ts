export const MAX_AGENT_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_AGENT_ATTACHMENTS = 4;

export type AgentAttachmentKind = "image" | "pdf" | "text" | "workbook";
export type AgentAttachment = { name: string; kind: AgentAttachmentKind; bytes: Uint8Array };

const EXTENSIONS: Record<string, AgentAttachmentKind> = {
  png: "image", jpg: "image", jpeg: "image", webp: "image",
  pdf: "pdf", txt: "text", md: "text", csv: "text", tsv: "text", ord: "text", xlsx: "workbook",
};

export function attachmentPickerAccept(group: "image" | "document"): string {
  return Object.entries(EXTENSIONS)
    .filter(([, kind]) => group === "image" ? kind === "image" : kind !== "image")
    .map(([extension]) => `.${extension}`)
    .join(",");
}

export function attachmentKind(name: string): AgentAttachmentKind {
  const extension = name.split(".").at(-1)?.toLowerCase();
  const kind = extension ? EXTENSIONS[extension] : undefined;
  if (!kind) throw new Error("Attach a PNG, JPEG, WebP, PDF, XLSX, or text file (.txt, .md, .csv, .tsv, .ord).");
  return kind;
}

export function checkAttachment(file: Pick<File, "name" | "size">): AgentAttachmentKind {
  const kind = attachmentKind(file.name);
  if (file.size === 0) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_AGENT_ATTACHMENT_BYTES) throw new Error(`${file.name} is too large (16 MiB maximum).`);
  return kind;
}

export function checkAttachmentSelection(files: readonly Pick<File, "name" | "size">[]): void {
  if (files.length > MAX_AGENT_ATTACHMENTS) throw new Error("Attach up to four files at a time.");
  files.forEach(checkAttachment);
}

export async function readAttachments(files: readonly File[]): Promise<AgentAttachment[]> {
  checkAttachmentSelection(files);
  return Promise.all(files.map(async file => ({ name: file.name, kind: checkAttachment(file), bytes: new Uint8Array(await file.arrayBuffer()) })));
}

export function verifyAttachmentBytes(attachment: AgentAttachment): void {
  if (!attachment || typeof attachment.name !== "string" || !(attachment.bytes instanceof Uint8Array)) throw new TypeError("Invalid assistant attachment.");
  const kind = checkAttachment({ name: attachment.name, size: attachment.bytes.byteLength });
  if (kind !== attachment.kind) throw new TypeError("Attachment type does not match its filename.");
  const bytes = attachment.bytes;
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const valid = kind === "pdf" ? starts(0x25, 0x50, 0x44, 0x46, 0x2d)
    : kind === "workbook" ? starts(0x50, 0x4b, 0x03, 0x04)
    : kind === "text" ? !bytes.includes(0)
    : /\.png$/i.test(attachment.name) ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : /\.webp$/i.test(attachment.name) ? starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    : starts(0xff, 0xd8, 0xff);
  if (!valid) throw new Error(`${attachment.name} does not match its file type.`);
}
