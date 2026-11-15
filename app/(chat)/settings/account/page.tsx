import { redirect } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { AccountSettings } from "@/components/chat/account-settings";
import { guestRegex } from "@/lib/constants";

export const metadata = {
  title: "Account & data",
};

export default async function AccountSettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const email = session.user.email ?? "";

  return (
    <AccountSettings
      email={email}
      isGuest={session.user.type === "guest" || guestRegex.test(email)}
    />
  );
}
