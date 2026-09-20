import { messagingApi, validateSignature, WebhookEvent } from '@line/bot-sdk';
import { DEFAULT_REPLY } from '@/lib/constants';
import { generateReply } from '@/lib/gemini';
import { getFaqCsv } from '@/lib/sheet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
});

async function handleEvent(event: WebhookEvent) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }

  const userText = event.message.text;
  const replyToken = event.replyToken;

  let reply: string;
  try {
    const faqCsv = await getFaqCsv();
    reply = await generateReply(userText, faqCsv);
  } catch (err) {
    console.error('webhook: no faq available, using default reply', err);
    reply = DEFAULT_REPLY;
  }

  try {
    await client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: reply }],
    });
  } catch (err) {
    console.error('webhook: replyMessage failed', err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-line-signature') ?? '';
    const channelSecret = process.env.LINE_CHANNEL_SECRET ?? '';

    if (!validateSignature(body, channelSecret, signature)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { events } = JSON.parse(body) as { events: WebhookEvent[] };

    await Promise.all(events.map((event) => handleEvent(event)));

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('webhook: unexpected error', err);
    return new Response('OK', { status: 200 });
  }
}
