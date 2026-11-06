// Xuất CSV mở được bằng Excel (UTF-8 BOM)
export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const csv = "\ufeff" + [head, ...rows].map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
