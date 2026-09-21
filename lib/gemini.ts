import { GoogleGenAI } from '@google/genai';
import {
  DEFAULT_REPLY,
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_MODEL,
  GEMINI_THINKING_BUDGET,
  GEMINI_TIMEOUT_MS,
} from './constants';
import { selectRelevantFaqCsv } from './faq';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function buildPrompt(faqCsv: string, userMessage: string) {
  return `<role>
คุณคือพนักงานฝ่ายบริการลูกค้าของ Hostatom
ผู้ให้บริการ Web Hosting, Server และ Cloud
บริการที่มี: Web Hosting, Reseller Hosting, Cloud VPS SSD, Email Service,
Dedicated Server (TH/SG/US/EU), SSL Certificate, Google Service,
Microsoft Service, Microsoft SQL Server, Private Hosting, Imunify360,
จดทะเบียนโดเมนใหม่ และโอนย้ายโดเมน
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามใช้ความรู้นอกเหนือจากนี้
- ห้ามแต่งหรือเดา ราคา โปรโมชัน เงื่อนไข ระยะเวลา สเปก หรือที่ตั้ง เด็ดขาด
- ให้ถือว่าคำถามที่ใช้คำพ้อง คำใกล้เคียง สะกดต่างกันเล็กน้อย หรือถามแบบภาษาพูด
  เป็นคำถามเดียวกับข้อมูลใน <faq> ได้ ถ้าเจตนาชัดเจนและคำตอบมีอยู่ใน <faq>
- ถ้าแถวใดมีคอลัมน์ "คำตัดสิทธิ์" และคำถามตรงกับคำในคอลัมน์นั้น
  ห้ามใช้แถวนั้นเป็นแหล่งคำตอบ ให้หาแถวอื่นที่ตรงกว่าแทน
- ถ้าคำถามไม่ตรงกับข้อมูลใน <faq> หรือมีข้อมูลไม่ครบพอจะตอบ
  ให้ตอบข้อความนี้เท่านั้น คำต่อคำ ห้ามเติมหรือตัดคำ:
  ${DEFAULT_REPLY}
- โทน: สุภาพแบบเป็นกันเอง แทนตัวเองว่า "ผม" ไม่ต้องเรียกลูกค้าด้วยสรรพนามใด ๆ
- ใช้ emoji ได้ไม่เกิน 1 ตัวต่อข้อความ หรือไม่ใช้เลยก็ได้
- ความยาว 1-3 ประโยค ตอบตรงคำถาม ไม่ต้องอารัมภบท ไม่ต้องทักทายซ้ำ
  ไม่ต้องเสนอข้อมูลเกินที่ถูกถาม
- อธิบายด้วยภาษาที่คนทั่วไปเข้าใจ เลี่ยงศัพท์เทคนิคถ้าไม่จำเป็น
- ห้ามบอกว่าตัวเองเป็น AI ห้ามพูดถึง FAQ ตาราง ชีต หรือระบบหลังบ้าน
</constraints>

<greeting_handling>
ถ้าข้อความจากลูกค้าเป็นแค่คำทักทายหรือคำพูดทั่วไป (เช่น "สวัสดี", "หวัดดี", "ขอบคุณครับ/ค่ะ")
โดยไม่ได้ถามเรื่องบริการ ให้ทักทายกลับสั้น ๆ แนะนำตัวว่าเป็นผู้ช่วยของ Hostatom
แล้วถามว่ามีอะไรให้ช่วยเกี่ยวกับบริการไหม กรณีนี้ไม่ต้องใช้ข้อมูลจาก <faq>
และไม่ต้องตอบข้อความ default
ถ้าข้อความมีคำถามเกี่ยวกับบริการปนอยู่ด้วย ให้ยึดกฎเรื่องคำถามบริการเป็นหลักตามปกติ
</greeting_handling>

<output_format>
ตอบเป็นภาษาไทย ข้อความธรรมดาเท่านั้น
ห้ามใช้ markdown ห้ามใช้ ** ## - หรือ bullet ใด ๆ
ตอบเฉพาะข้อความที่จะส่งให้ลูกค้า ไม่ต้องมีคำอธิบายอื่น
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${userMessage}
</question>`;
}

function logGemini(fields: {
  finishReason?: string;
  thoughtsTokenCount?: number;
  candidatesTokenCount?: number;
  usedDefault: boolean;
  reason: 'ok' | 'max_tokens' | 'timeout' | 'no_faq' | 'empty' | 'api_error';
  latencyMs: number;
}) {
  console.log(
    JSON.stringify({
      tag: 'gemini',
      ...fields,
    })
  );
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('gemini timeout')), ms);
  });
}

export async function generateReply(
  userMessage: string,
  faqCsv: string
): Promise<string> {
  const start = Date.now();
  const relevantFaqCsv = selectRelevantFaqCsv(faqCsv, userMessage);
  const prompt = buildPrompt(relevantFaqCsv, userMessage);

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          thinkingConfig: {
            thinkingBudget: GEMINI_THINKING_BUDGET,
          },
        },
      }),
      timeout(GEMINI_TIMEOUT_MS),
    ]);

    const finishReason = response.candidates?.[0]?.finishReason;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount;
    const candidatesTokenCount = response.usageMetadata?.candidatesTokenCount;
    const latencyMs = Date.now() - start;

    if (finishReason === 'MAX_TOKENS') {
      logGemini({
        finishReason,
        thoughtsTokenCount,
        candidatesTokenCount,
        usedDefault: true,
        reason: 'max_tokens',
        latencyMs,
      });
      return DEFAULT_REPLY;
    }

    const text = response.text?.trim();
    if (!text) {
      logGemini({
        finishReason,
        thoughtsTokenCount,
        candidatesTokenCount,
        usedDefault: true,
        reason: 'empty',
        latencyMs,
      });
      return DEFAULT_REPLY;
    }

    logGemini({
      finishReason,
      thoughtsTokenCount,
      candidatesTokenCount,
      usedDefault: false,
      reason: 'ok',
      latencyMs,
    });
    return text;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.message === 'gemini timeout';
    console.error('gemini: request failed', err);
    logGemini({
      usedDefault: true,
      reason: isTimeout ? 'timeout' : 'api_error',
      latencyMs,
    });
    return DEFAULT_REPLY;
  }
}
