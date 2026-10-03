import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Clerk owns authentication now (sign-in, invitations, password resets).
// Everything except the auth screens and assets requires a session.
const isPublicRoute = createRouteMatcher(["/login(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Everything except static assets and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
