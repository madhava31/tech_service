// The mock mail provider. It NEVER sends anything: no SMTP, Gmail or Outlook connection, no network
// call, and nothing is written to disk. It only checks that the prepared message is complete and
// returns an explicit "simulated" result, so the whole send flow can be built and tested without any
// credentials. It does not keep the message, the addresses or the PDF.

export const STATUS_SIMULATED = 'SIMULATED_NOT_SENT';

export const mockProvider = {
  name: 'mock',
  /**
   * @param {{ from: {name: string, address: string|null}, to: string[], cc: string[], subject: string, text: string,
   *           attachments: {filename: string, contentType: string, content: Buffer}[] }} mail
   */
  async send(mail) {
    if (!mail || !Array.isArray(mail.to) || mail.to.length === 0) throw new Error('Mock provider: no recipient');
    if (!mail.subject || !mail.text) throw new Error('Mock provider: subject and message are required');
    for (const a of mail.attachments || []) {
      if (!a.filename || !Buffer.isBuffer(a.content) || a.content.length === 0) throw new Error('Mock provider: invalid attachment');
    }
    return {
      status: STATUS_SIMULATED,
      simulated: true,
      provider: 'mock',
      messageId: null, // a simulated message has no provider message id
      attachmentCount: (mail.attachments || []).length,
    };
  },
};
