const CONTACT_EMAIL = "atanub707@gmail.com";

// Trial state banner. Pure display — the data layer computes days/ended.
// Renders nothing for active plans or more than 7 days left.
export function TrialBanner({
  trialDaysLeft,
  trialEnded,
}: {
  trialDaysLeft: number | null;
  trialEnded: boolean;
}) {
  if (trialEnded) {
    return (
      <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-800">
        Trial ended —{" "}
        <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
          contact us to continue
        </a>
        . Reading and copying still work; changes are paused.
      </div>
    );
  }

  if (trialDaysLeft === null || trialDaysLeft > 7) return null;

  const urgent = trialDaysLeft <= 1;
  return (
    <div
      className={`border-b px-4 py-2 text-[12px] ${
        urgent
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      {urgent ? "Trial: last day" : `Trial: ${trialDaysLeft} days left`} —{" "}
      <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
        contact us to continue
      </a>
    </div>
  );
}
