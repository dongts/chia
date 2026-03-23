import { Outlet } from "react-router-dom";

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      <Outlet />
    </div>
  );
}
