const FAQ_HEADERS = ['หมวด', 'คำถาม', 'คำตอบ', 'คำสำคัญ', 'คำตัดสิทธิ์'];
const MAX_RELEVANT_ROWS = 8;

const SYNONYMS: Record<string, string[]> = {
  hosting: ['โฮสติ้ง', 'host', 'เว็บโฮส', 'web hosting', 'shared hosting'],
  ราคา: ['กี่บาท', 'เท่าไหร่', 'เท่าไร', 'ค่าบริการ', 'แพ็กเกจ', 'package', 'price'],
  จ่ายเงิน: ['ชำระเงิน', 'โอนเงิน', 'บัตรเครดิต', 'paypal', 'promptpay', 'qr'],
  ติดต่อ: ['เบอร์', 'โทร', 'โทรศัพท์', 'line', 'ไลน์', 'email', 'อีเมล', 'support', 'sales'],
  server: ['เซิร์ฟเวอร์', 'เครื่อง', 'ที่ตั้ง', 'location', 'ประเทศ', 'data center'],
  vps: ['cloud', 'cloud vps', 'เครื่องเสมือน', 'server ส่วนตัว', 'เซิร์ฟเวอร์ส่วนตัว'],
  domain: ['โดเมน', 'จดโดเมน', 'ย้ายโดเมน', 'transfer domain', 'name server', 'dns'],
  email: ['เมล', 'อีเมล', 'mail', 'webmail', 'outlook', 'gmail องค์กร'],
  ssl: ['https', 'certificate', 'ใบรับรอง', 'ความปลอดภัย'],
  wordpress: ['wp', 'เวิร์ดเพรส', 'elementor'],
  reseller: ['ตัวแทน', 'agency', 'ลูกค้าย่อย'],
  restore: ['กู้คืน', 'backup', 'แบ็กอัพ', 'ย้อนกลับ'],
  error: ['เว็บล่ม', 'เข้าเว็บไม่ได้', 'เสีย', 'ล่ม', 'ปัญหา', 'ใช้งานไม่ได้'],
  trial: ['ทดลอง', 'ลองใช้', 'demo', 'refund', 'คืนเงิน'],
};

interface FaqRow {
  category: string;
  question: string;
  answer: string;
  keywords: string;
  exclusions: string;
  raw: string[];
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);

  return rows;
}

function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function expandQuery(query: string): string {
  const normalized = normalize(query);
  const additions = new Set<string>();

  for (const [base, words] of Object.entries(SYNONYMS)) {
    const allWords = [base, ...words].map(normalize);
    if (allWords.some((word) => normalized.includes(word))) {
      allWords.forEach((word) => additions.add(word));
    }
  }

  return `${normalized} ${Array.from(additions).join(' ')}`.trim();
}

function charNgrams(text: string, size: number): Set<string> {
  const compact = normalize(text).replace(/\s+/g, '');
  const grams = new Set<string>();

  for (let i = 0; i <= compact.length - size; i += 1) {
    grams.add(compact.slice(i, i + size));
  }

  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;

  let overlap = 0;
  for (const item of a) {
    if (b.has(item)) overlap += 1;
  }

  return (2 * overlap) / (a.size + b.size);
}

function keywordScore(query: string, keywords: string): number {
  return keywords
    .split(',')
    .map((keyword) => normalize(keyword))
    .filter(Boolean)
    .reduce((score, keyword) => {
      if (query.includes(keyword)) return score + 5;
      if (diceCoefficient(charNgrams(query, 2), charNgrams(keyword, 2)) >= 0.45) {
        return score + 2;
      }
      return score;
    }, 0);
}

function exclusionPenalty(query: string, exclusions: string): number {
  return exclusions
    .split(',')
    .map((exclusion) => normalize(exclusion))
    .filter(Boolean)
    .reduce((penalty, exclusion) => {
      if (query.includes(exclusion)) return penalty + 8;
      if (diceCoefficient(charNgrams(query, 2), charNgrams(exclusion, 2)) >= 0.55) {
        return penalty + 3;
      }
      return penalty;
    }, 0);
}

function rowScore(expandedQuery: string, row: FaqRow): number {
  const question = normalize(row.question);
  const category = normalize(row.category);
  const answer = normalize(row.answer);
  const searchable = `${category} ${question} ${normalize(row.keywords)}`;
  const queryBigrams = charNgrams(expandedQuery, 2);
  const queryTrigrams = charNgrams(expandedQuery, 3);

  let score = keywordScore(expandedQuery, row.keywords);
  score -= exclusionPenalty(expandedQuery, row.exclusions);

  if (expandedQuery.includes(category)) score += 4;
  if (expandedQuery.includes(question) || question.includes(expandedQuery)) score += 8;
  if (searchable.includes(expandedQuery)) score += 5;
  if (answer.includes(expandedQuery)) score += 2;

  score += diceCoefficient(queryBigrams, charNgrams(searchable, 2)) * 8;
  score += diceCoefficient(queryTrigrams, charNgrams(searchable, 3)) * 6;

  return score;
}

export function selectRelevantFaqCsv(faqCsv: string, userMessage: string): string {
  const rows = parseCsv(faqCsv);
  const bodyRows = rows[0]?.some((cell) => FAQ_HEADERS.includes(cell.trim()))
    ? rows.slice(1)
    : rows;

  const faqRows: FaqRow[] = bodyRows
    .filter((row) => row.length >= 3)
    .map((row) => ({
      category: row[0] ?? '',
      question: row[1] ?? '',
      answer: row[2] ?? '',
      keywords: row[3] ?? '',
      exclusions: row[4] ?? '',
      raw: [
        row[0] ?? '',
        row[1] ?? '',
        row[2] ?? '',
        row[3] ?? '',
        row[4] ?? '',
      ],
    }));

  if (faqRows.length <= MAX_RELEVANT_ROWS) {
    return toCsv([FAQ_HEADERS, ...faqRows.map((row) => row.raw)]);
  }

  const expandedQuery = expandQuery(userMessage);
  const scoredRows = faqRows
    .map((row) => ({ row, score: rowScore(expandedQuery, row) }))
    .sort((a, b) => b.score - a.score);

  const topRows = scoredRows
    .filter(({ score }, index) => score >= 3 || index < 3)
    .slice(0, MAX_RELEVANT_ROWS)
    .map(({ row }) => row.raw);

  return toCsv([FAQ_HEADERS, ...topRows]);
}
