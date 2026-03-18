import { Link, Outlet } from "react-router";

export default function Layout() {
  return (
    <>
      <nav className="bg-white shadow px-6 py-3 flex gap-4">
        <Link to="/" className="text-gray-700 hover:text-gray-900 font-medium">
          Home
        </Link>
      </nav>
      <Outlet />
    </>
  );
}
