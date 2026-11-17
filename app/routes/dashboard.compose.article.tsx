import { redirect, type LoaderFunctionArgs } from "react-router";

export async function loader({ url }: LoaderFunctionArgs) {
  const target = new URL("/dashboard/compose", url.origin);
  target.searchParams.set("type", "article");
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "type") {
      target.searchParams.append(key, value);
    }
  }
  return redirect(`${target.pathname}${target.search}`, 302);
}

export default function ComposeArticleCompatibility() {
  return null;
}
