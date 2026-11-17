import { redirect } from "next/navigation";

import { auth } from "@/app/(auth)/auth";
import { AccountSettings } from "@/components/chat/account-settings";
import { guestRegex } from "@/lib/constants";
import { getUserById } from "@/lib/db/queries";

export const metadata = {
  title: "Account & data",
};

export default async function AccountSettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const account = await getUserById(session.user.id);
  const email = account?.email ?? session.user.email ?? "";
  const isGuest = session.user.type === "guest" || guestRegex.test(email);

  return (
    <AccountSettings
      email={email}
      emailVerified={Boolean(account?.emailVerified)}
      isGuest={isGuest}
    />
  );
}
