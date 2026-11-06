"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { AuthFrame } from "@/components/auth-frame";

function Confirm() {
  const sp = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const token_hash = sp.get("token_hash");
    const type = sp.get("type");
    if (!token_hash || (type !== "invite" && type !== "recovery")) { router.replace("/login/?error=link"); return; }
    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      // xóa token khỏi thanh địa chỉ ngay sau khi dùng
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(error ? "/login/?error=link" : "/dat-mat-khau/");
    });
  }, [sp, router]);
  return <p className="text-sm text-muted">Đang xác thực link…</p>;
}

export default function ConfirmPage() {
  return <AuthFrame title="Kích hoạt tài khoản" subtitle="Vui lòng chờ trong giây lát."><Suspense><Confirm /></Suspense></AuthFrame>;
}
