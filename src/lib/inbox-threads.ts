import { queryOne } from '@/lib/database';

export * from './inbox-thread-utils';

type ThreadCandidate = { id: string; thread_id: string | null; subject: string };

export async function findReferencedThread(apiKeyId: string, messageIds: string[]) {
  for (const messageId of messageIds) {
    const received = await queryOne<ThreadCandidate>(
      'SELECT id,thread_id,subject FROM received_emails WHERE api_key_id=? AND message_id=? ORDER BY received_at DESC,id DESC LIMIT 1',
      [apiKeyId, messageId],
    );
    if (received) return { id: received.thread_id || received.id, source: 'received' as const, sourceId: received.id, subject: received.subject };

    const sent = await queryOne<ThreadCandidate>(
      'SELECT id,thread_id,subject FROM emails WHERE api_key_id=? AND message_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
      [apiKeyId, messageId],
    );
    if (sent) return { id: sent.thread_id || sent.id, source: 'sent' as const, sourceId: sent.id, subject: sent.subject };
  }
  return null;
}
