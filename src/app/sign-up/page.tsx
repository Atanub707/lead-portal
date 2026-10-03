import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f7f7f8] px-4 py-10">
      <SignUp />
    </div>
  );
}
