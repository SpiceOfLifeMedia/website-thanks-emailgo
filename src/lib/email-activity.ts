import { execute } from '@/lib/database';

export async function recordEmailSentActivity(emailId: string, sentAt: string) {
  try {
    await execute("INSERT INTO email_events(id,email_id,type,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING", ['email.sent:' + emailId, emailId, 'email.sent', sentAt]);
    return true;
  } catch {
    // Email acceptance has already succeeded. The activity endpoint can fall back to the sent email record.
    return false;
  }
}
