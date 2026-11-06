// Đã vô hiệu hóa sau khi khởi tạo Admin (06/11/2026).
Deno.serve(() => new Response(JSON.stringify({ error: "disabled" }), { status: 410, headers: { "Content-Type": "application/json" } }));
