export type ReceiptMime = 'image/jpeg' | 'image/png' | 'image/webp';

export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
export const MAX_RECEIPTS_PER_ENTRY = 3;

export interface AttachmentVM {
  id: string;
  mimeType: ReceiptMime;
  byteSize: number;
  uploadedBy: string;
  createdAt: string;
}
