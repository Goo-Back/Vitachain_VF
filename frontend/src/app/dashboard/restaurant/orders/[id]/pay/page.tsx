import { notFound } from "next/navigation";

import { fetchOrderById } from "../../actions";
import { PSPCheckout } from "./PSPCheckout";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Mock payment-partner landing. In production this whole route is replaced
 * by a redirect (302 or HTTP POST) to PayMaroc's hosted checkout; today the
 * UI lives in-app to demonstrate the flow without a third-party contract.
 */
export default async function PayPage({ params }: Props) {
  const { id } = await params;
  const order = await fetchOrderById(id);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-2xl py-4">
      <PSPCheckout
        orderId={order.id}
        amount={Number(order.total_mad)}
        reference={`VITA-${order.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`}
      />
    </div>
  );
}
