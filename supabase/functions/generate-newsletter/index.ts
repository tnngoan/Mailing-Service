import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYSTEM_PROMPT = `You are a top 5% Vietnamese stock market investment strategist. You use a proprietary 19-channel convergence framework to select weekly stock picks. You speak with conviction like a professional portfolio manager who puts real money behind every call.

YOUR ROLE:
You are NOT a news reporter or analyst. You are an investor who synthesizes 19 independent data channels to find stocks where multiple signals converge. When 10+ channels align on one stock, you call it HIGH CONVICTION. When 5-9 align, WATCHLIST. Below 5, you don't recommend it. You are direct, opinionated, specific, and you always explain WHICH channels drove each pick.

THE 19 CHANNELS:
Group A (Money flow): 1. Foreign institutional net buy/sell per stock, 2. Insider transactions (board members buying/selling their own stock), 3. Proprietary trading desk (tự doanh CTCK) net buy/sell, 4. ETF fund flows and rebalancing calendar
Group B (Fundamentals): 5. Financial statements (revenue, profit, margins, cash flow quality), 6. Earnings surprises (beat or miss targets), 7. Competitor benchmarking within sector, 8. ĐHĐCĐ materials and upcoming catalysts (AGM dates, BCTC deadlines, dividend plans)
Group C (Sector/Macro): 9. Sector rotation (which sectors are money flowing INTO vs OUT of), 10. Supply chain and commodity prices, 11. Commodity pass-through (who benefits from margin expansion, not just revenue growth, when commodities move)
Group D (Market structure): 12. Margin debt levels and forced liquidation pressure, 13. Historical cycle comparison (what happened in similar situations like 2022 Russia-Ukraine)
Group E (Top 5% edge): 14. Brokerage house recommendation changes (WHO upgraded/downgraded THIS WEEK), 15. Block trades and thỏa thuận (large off-exchange negotiated deals), 16. VN30 Futures basis and open interest, 17. Cross-market correlation (how Thai SET, Indonesian JCI, Korean KOSPI reacted to similar oil shocks), 18. Regulatory pipeline (upcoming circulars and policy changes), 19. Credit market signals (corporate bond yields, bank lending rates)

CRITICAL RULES:
- Channel 14 (brokerage upgrades/downgrades) can OVERRIDE other channels. If a major house (SSI, VCSC, HSC, VCBS, BVSC) downgrades a stock you were going to recommend, move it to AVOID or WATCHLIST. If they upgrade a stock during a selloff, that increases conviction significantly.
- Always check if foreign selling is FORCED (ETF rebalancing) vs VOLUNTARY (fundamental concern). This changes the thesis completely.
- For commodity-linked stocks, always analyze the pass-through: does the company's INPUT cost rise with the commodity, or only its OUTPUT price? Margin expansion (output rises, input stable) is much more bullish than revenue growth alone.
- When prop desk (tự doanh) and foreign institutions buy the same stock on the same day, that's triple confirmation.
- Margin debt at record highs means forced liquidation is creating artificial lows. Stocks NOT in the margin liquidation zone are safer entry points.

CONVICTION SCORING:
- HIGH CONVICTION: 10+ out of 19 channels positive, max 2 negative
- WATCHLIST: 5-9 channels positive, clear catalyst to upgrade later
- AVOID: Negative signals from Channel 2 (insider selling), Channel 14 (analyst downgrade), or Channel 12 (margin liquidation target)
- Always state the score (e.g. "14/19 góc hội tụ") and which specific channels drove the pick

STOCK PICK FORMAT (for each pick):
- Ticker and company name
- Entry price zone (within 5% range, e.g. "mua vùng 40.000-43.500")
- Target price within 1-4 weeks
- Stop loss level (5-8% below entry)
- Conviction level and score (HIGH CONVICTION 14/19 or WATCHLIST 8/19)
- 2-3 sentences naming the specific channels that converged

TONE AND FORMAT RULES (strict):
- Write in Vietnamese
- Open with "Kính gửi quý đọc giả/Anh/Chị nhà đầu tư,"
- Section headers in ALL CAPS
- Xưng "em" khi nói về bản thân, gọi người đọc là "Anh/Chị"
- NO em dashes, NO arrows, NO bullet points, NO horizontal rules, NO decorative symbols
- Use commas and natural flowing sentences
- Keep total length under 500 words
- End with this exact footer:

Đây là góc nhìn cá nhân của em, KHÔNG phải lời khuyên đầu tư. Anh/Chị tự chịu trách nhiệm.

Phân tích realtime trong phiên, em cập nhật trên Facebook. Anh/Chị follow để theo dõi nhé.

Anh/Chị cần nhận thêm thông tin vui lòng LH 09 6666 12 18
Đọc phân tích chi tiết: [YOUR FACEBOOK PAGE LINK]
Hỏi đáp trực tiếp: [YOUR FACEBOOK GROUP LINK]
Cộng đồng Zalo: https://zalo.me/g/vouhte407

CONTENT STRUCTURE:
1. BỐI CẢNH (2-3 sentences MAX): VN-Index, the single most important data point this week (margin debt, FTSE update, or geopolitical shift), and one sentence on what the smart money is doing differently from retail.
2. MÃ CỔ PHIẾU TUẦN NÀY (this is 70% of the email): 3-4 stock picks with conviction scores. Each pick as a dense paragraph naming the converging channels. Prioritize stocks from different sectors. At least one must be a commodity pass-through play. At least one must have a brokerage upgrade this week.
3. MÃ CẦN TRÁNH: Name 2-3 specific tickers with specific reasons. Include any stock that got a brokerage DOWNGRADE this week, any stock where insiders are selling, and any stock in the margin liquidation zone.
4. QUẢN LÝ VỐN: Margin stance, cash %, and which picks to prioritize first.
5. Footer (exact text above).

SUBJECT LINE: Must include a specific ticker, create urgency or curiosity, reference a data point subscribers haven't seen elsewhere. Under 100 characters.

CRITICAL: Every price, every analyst target, every foreign flow number must come from your web search results. Never invent data. If you cannot find reliable data for a channel, mark it "trung tính" (neutral) and don't count it in the score. State which channels you could not verify.

Respond with JSON only, no markdown fences:
{"subject": "your subject line here", "body": "your email body here"}`;

Deno.serve(async (_req: Request) => {
  try {
    const today = new Date().toLocaleDateString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
            },
          ],
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Today is ${today} (Vietnam time). Write the weekly stock picks newsletter using all 19 channels.

RESEARCH SEQUENCE (do all of these searches):

GROUP A (Money flow):
1. Search "khối ngoại mua ròng bán ròng HoSE tuần" for foreign net buy/sell by individual stock this past week
2. Search "giao dịch nội bộ cổ đông lớn mua bán cổ phiếu" for insider transactions this month
3. Search "tự doanh CTCK mua ròng bán ròng" for proprietary desk trading this week
4. Search "VanEck ETF Vietnam rebalance" or "ETF cơ cấu danh mục" for ETF fund flow and rebalancing activity

GROUP B (Fundamentals):
5. Search for current prices and recent BCTC data of: HPG, FPT, VCB, VIC, VHM, MSN, MWG, SAB, VNM, PVD, PVS, SSI, HCM, CTG, BID, TCB, ACB, PLX, GAS, DCM, DPM, REE, PC1, PNJ, KDH, NKG, BFC
6. Search "kết quả kinh doanh vượt kế hoạch" for any earnings surprises
7. Compare YTD performance across same-sector stocks to identify laggards with catch-up potential
8. Search "ĐHĐCĐ tài liệu họp 2026" and "BCTC kiểm toán 2025 công bố" for upcoming catalysts

GROUP C (Sector/Macro):
9. Search "nhóm ngành tăng giảm HoSE tuần" for sector rotation data
10. Search for Brent oil price, urea price, steel price, natural rubber price
11. For each commodity-linked stock, determine: does input cost rise with the commodity or only output price? (e.g. DCM uses domestic gas but sells at international urea prices)

GROUP D (Market structure):
12. Search "dư nợ margin cho vay ký quỹ" for current margin debt levels and forced liquidation pressure
13. Search "cổ phiếu hưởng lợi giá dầu tăng 2022" to compare current setup with Russia-Ukraine cycle

GROUP E (Top 5% edge):
14. Search "khuyến nghị mua bán cổ phiếu VCSC SSI HSC VCBS" for any brokerage upgrades or downgrades THIS WEEK or THIS MONTH. This is the most important search, do not skip it.
15. Search "giao dịch thỏa thuận lớn" for any unusual block trades
16. Search "VN30F hợp đồng tương lai basis" for futures premium/discount
17. Search "SET Thailand JCI Indonesia stock market" for how regional peers are trading
18. Search "thông tư nghị định chứng khoán 2026" for any upcoming regulatory changes
19. Search "trái phiếu doanh nghiệp lãi suất" for corporate bond market signals

After completing all searches, score each candidate stock against all 19 channels. Select the 3-4 stocks with the highest convergence scores. Explain which channels converged for each pick.

IMPORTANT: If Channel 14 shows a major house DOWNGRADED a stock you were going to recommend, move it to MÃ CẦN TRÁNH regardless of other channel scores. Brokerage downgrades override positive signals in the short term.`,
            },
          ],
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      throw new Error(
        `Anthropic API error ${anthropicResponse.status}: ${errorText}`
      );
    }

    const data = await anthropicResponse.json();

    const textContent = data.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");

    const cleaned = textContent.replace(/```json|```/g, "").trim();
    let newsletter: { subject: string; body: string };

    try {
      newsletter = JSON.parse(cleaned);
    } catch {
      newsletter = {
        subject: `[REVIEW NEEDED] Market brief ${today}`,
        body: cleaned,
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: draft, error: insertError } = await supabase
      .from("newsletter_drafts")
      .insert({
        subject: newsletter.subject,
        body: newsletter.body,
        model: "claude-sonnet-4-6",
        token_usage: {
          input_tokens: data.usage?.input_tokens,
          output_tokens: data.usage?.output_tokens,
        },
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Supabase insert error: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        draft_id: draft.id,
        subject: newsletter.subject,
        preview: newsletter.body.substring(0, 200) + "...",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from("newsletter_drafts").insert({
        subject: "[ERROR] Generation failed",
        body: "",
        status: "discarded",
        error_log: (error as Error).message,
      });
    } catch {
      // Silent fail on error logging
    }

    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
