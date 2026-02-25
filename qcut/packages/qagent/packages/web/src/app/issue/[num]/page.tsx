import { redirect, notFound } from "next/navigation";
import { getServices } from "@/lib/services";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ num: string }>;
}) {
  const { num } = await params;

  // Validate: must be a number
  if (!/^\d+$/.test(num)) {
    notFound();
  }

  const { sessionManager } = await getServices();
  const sessions = await sessionManager.list();

  // Find session working on this issue number
  const match = sessions.find(
    (s) => s.issueId === num || s.issueId === `#${num}`,
  );

  if (match) {
    redirect(`/sessions/${match.id}`);
  }

  notFound();
}
