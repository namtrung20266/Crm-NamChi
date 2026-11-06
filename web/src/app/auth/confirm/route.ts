import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Mở link kích hoạt / đặt lại mật khẩu → tạo phiên → chuyển tới trang đặt mật khẩu
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const dest = url.clone();
  dest.search = "";
  if (token_hash && (type === "invite" || type === "recovery")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      dest.pathname = "/dat-mat-khau";
      return NextResponse.redirect(dest);
    }
  }
  dest.pathname = "/login";
  dest.searchParams.set("error", "link");
  return NextResponse.redirect(dest);
}
