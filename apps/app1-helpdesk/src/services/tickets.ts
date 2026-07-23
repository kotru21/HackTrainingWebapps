import { query } from '../db';

export type TicketStatus = 'open' | 'in_progress' | 'closed';

export interface Ticket {
  id: number;
  title: string;
  body: string;
  status: TicketStatus;
  owner_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface Attachment {
  id: number;
  ticket_id: number;
  filename: string;
  content_type: string;
  created_at: Date;
}

export async function listTicketsForUser(userId: number, isAdmin: boolean): Promise<Ticket[]> {
  if (isAdmin) {
    const result = await query<Ticket>('SELECT * FROM tickets ORDER BY id');
    return result.rows;
  }
  const result = await query<Ticket>(
    'SELECT * FROM tickets WHERE owner_id = $1 ORDER BY id',
    [userId],
  );
  return result.rows;
}

export async function getTicket(id: number): Promise<Ticket | null> {
  const result = await query<Ticket>('SELECT * FROM tickets WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function createTicket(
  ownerId: number,
  title: string,
  body: string,
): Promise<Ticket> {
  const result = await query<Ticket>(
    `INSERT INTO tickets (title, body, status, owner_id)
     VALUES ($1, $2, 'open', $3)
     RETURNING *`,
    [title, body, ownerId],
  );
  return result.rows[0];
}

export async function updateTicketStatus(
  id: number,
  status: TicketStatus,
): Promise<Ticket | null> {
  const result = await query<Ticket>(
    `UPDATE tickets SET status = $2, updated_at = NOW() AT TIME ZONE 'utc'
     WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return result.rows[0] ?? null;
}

export async function addAttachment(
  ticketId: number,
  filename: string,
  contentType: string,
): Promise<Attachment> {
  const result = await query<Attachment>(
    `INSERT INTO attachments (ticket_id, filename, content_type)
     VALUES ($1, $2, $3) RETURNING *`,
    [ticketId, filename, contentType],
  );
  return result.rows[0];
}

export async function listAttachments(ticketId: number): Promise<Attachment[]> {
  const result = await query<Attachment>(
    'SELECT * FROM attachments WHERE ticket_id = $1 ORDER BY id',
    [ticketId],
  );
  return result.rows;
}

export async function listAdminSecrets(): Promise<{ id: number; name: string; value: string }[]> {
  // leak_flag is the CFG-LEAK scoring flag, capturable only through the /internal/debug
  // leak — exclude it here so the admin-access path (CFG-JWT) does not also hand it out.
  const result = await query<{ id: number; name: string; value: string }>(
    "SELECT id, name, value FROM admin_secrets WHERE name <> 'leak_flag' ORDER BY id",
  );
  return result.rows;
}
