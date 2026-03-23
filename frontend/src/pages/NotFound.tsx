import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 text-center">
      <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Wallet size={28} className="text-on-primary" />
      </div>
      <h1 className="text-6xl font-bold text-outline-variant mb-4">404</h1>
      <h2 className="text-xl font-semibold text-on-surface mb-2">Page not found</h2>
      <p className="text-sm text-on-surface-variant mb-8">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="inline-flex items-center bg-primary hover:bg-primary-dim text-on-primary font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
      >
        Go Home
      </Link>
    </div>
  );
}
