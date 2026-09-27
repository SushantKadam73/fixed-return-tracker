import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="mt-6 inline-block text-accent hover:underline">
        Go to the home page
      </Link>
    </div>
  );
}
