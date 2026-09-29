import { getProducts } from "@/features/products/queries/get-products";
import { toProduct } from "@/lib/api/v1/catalog";
import { apiOk, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Filas (produtos) ativas, por nome: o product_id de ticket e de categoria.
export const GET = withApi({ route: "/api/v1/products", scopes: ["catalog:read"] }, async ({ requestId }) => {
  const products = await getProducts();
  if (!products) return unavailable(requestId, "as filas");
  return apiOk(products.map(toProduct));
});
