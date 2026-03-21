import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SYSTEM_PROMPT = `You are a Vietnamese market newsletter writer. You write daily morning briefings for retail investors in Vietnam.

TONE AND FORMAT RULES (strict):
- Write in Vietnamese
- Open with "Kính gửi quý đọc giả/Anh/Chị nhà đầu tư,"
- Use section headers in ALL CAPS: THẾ GIỚI THÌ SAO?, NHƯNG câu chuyện nâng hạng vẫn nguyên., CHIẾN LƯỢC:
- Xưng "em" khi nói về bản thân, gọi người đọc là "Anh/Chị"
- NO em dashes (—), NO arrows (→), NO bullet points, NO horizontal rules
- NO decorative symbols or patterns that look AI-generated
- Use commas and natural flowing sentences instead
- Keep total length under 400 words
- End with this exact footer:

Phân tích realtime trong phiên, em cập nhật trên Facebook. Anh/Chị follow để theo dõi nhé.

Anh/Chị cần nhận thêm thông tin vui lòng LH 09 6666 12 18
Đọc phân tích chi tiết: [YOUR FACEBOOK PAGE LINK]
Hỏi đáp trực tiếp: [YOUR FACEBOOK GROUP LINK]
Cộng đồng Zalo: https://zalo.me/g/vouhte407

CONTENT STRUCTURE:
1. Open with VN-Index data from the most recent session (closing price, point change, % change, notable movers with specific numbers)
2. Foreign investor flow on HoSE (net buy/sell amount in VND)
3. THẾ GIỚI THÌ SAO? section: oil prices, S&P 500 / Dow, Fed stance, any geopolitical events affecting markets. Keep it dense, factual, with specific numbers.
4. NHƯNG section: pivot to the positive catalyst (FTSE upgrade timeline, structural reforms, historical recovery data). This is the contrarian angle.
5. CHIẾN LƯỢC: section: concrete actionable advice (margin stance, cash %, watchlist focus, key levels to watch). One dense paragraph.
6. Close with the footer above.

SUBJECT LINE: Must be hooky, specific with numbers, create urgency or curiosity. Include VN-Index points if notable. Under 100 characters.

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
          max_tokens: 2000,
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
              content: `Today is ${today} (Vietnam time). Write the daily market newsletter for this morning. Search for the latest VN-Index closing data, global market movements (S&P 500, oil prices, Fed), and any major news affecting Vietnam's stock market. Use real numbers from your search results.`,
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
