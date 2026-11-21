import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useRevalidator, useRouteLoaderData } from "react-router";

import {
  BTCPAY_CONFIRMATION_WATCH_STORAGE_KEY,
  clearBtcpayConfirmationWatch,
  readBtcpayConfirmationWatch,
} from "~/features/payments/btcpay-confirmation-watch-storage";
import type { PaymentStatusPayload } from "~/features/payments/hooks/usePaymentPolling";

function syncWatchFromStorage(): ReturnType<
  typeof readBtcpayConfirmationWatch
> {
  const w = readBtcpayConfirmationWatch();
  if (!w) return null;
  if (new Date(w.expiresAt).getTime() <= Date.now()) {
    clearBtcpayConfirmationWatch();
    return null;
  }
  return w;
}

/**
 * Floating notice when the user closed the BTCPay invoice modal after a 0-conf
 * payment was detected. Keeps polling until the first on-chain confirmation
 * completes access, without covering the header.
 */
export function BtcpayConfirmationWatchBar() {
  const loaderData = useRouteLoaderData<unknown>("root");
  const user =
    loaderData &&
    typeof loaderData === "object" &&
    "user" in loaderData &&
    loaderData.user &&
    typeof loaderData.user === "object" &&
    "id" in loaderData.user &&
    typeof loaderData.user.id === "string"
      ? (loaderData.user as { id: string })
      : null;
  const revalidator = useRevalidator();

  const [storageEpoch, setStorageEpoch] = useState(0);
  const bumpStorageRead = useCallback(() => {
    setStorageEpoch((n) => n + 1);
  }, []);

  const watch = useMemo(() => {
    if (!user) return null;
    storageEpoch;
    return syncWatchFromStorage();
  }, [user, storageEpoch]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (e: StorageEvent) => {
      if (e.key === BTCPAY_CONFIRMATION_WATCH_STORAGE_KEY) {
        bumpStorageRead();
      }
    };
    const onCustom = () => {
      bumpStorageRead();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("smartflow:btcpay-confirmation-watch", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        "smartflow:btcpay-confirmation-watch",
        onCustom
      );
    };
  }, [bumpStorageRead]);

  useEffect(() => {
    if (!watch || !user) return;

    const cancelledRef = { current: false };

    const poll = async () => {
      const formData = new FormData();
      formData.append("paymentId", watch.paymentId);
      let response: Response;
      try {
        response = await fetch("/api/payment-status", {
          method: "POST",
          body: formData,
        });
      } catch {
        return;
      }

      if (cancelledRef.current) return;

      if (response.status === 401 || response.status === 403) {
        clearBtcpayConfirmationWatch();
        return;
      }

      if (response.status === 404) {
        clearBtcpayConfirmationWatch();
        return;
      }

      if (!response.ok) return;

      let data: PaymentStatusPayload;
      try {
        data = (await response.json()) as PaymentStatusPayload;
      } catch {
        return;
      }

      if (data.success && data.paid) {
        clearBtcpayConfirmationWatch();
        toast.success("Bitcoin payment confirmed  -  your plan is active.");
        void revalidator.revalidate();
        return;
      }

      if (data.status === "EXPIRED") {
        clearBtcpayConfirmationWatch();
        toast.error(
          "That checkout expired. Start a new payment from Plans if needed."
        );
      }
    };

    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 10_000);

    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [watch, user, revalidator]);

  if (!user || !watch) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem_+_env(safe-area-inset-bottom))] z-40 flex justify-center px-3 sm:bottom-[calc(4.25rem_+_env(safe-area-inset-bottom))] sm:justify-end sm:px-4"
      role="status"
    >
      <div className="border-border bg-surface-overlay text-text shadow-3 pointer-events-auto w-full max-w-sm rounded-xl border p-3">
        <div className="flex items-start gap-3">
          <span className="bg-warning/15 text-warning-text mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Waiting for confirmation</p>
            <p className="text-text-secondary mt-1 text-xs leading-relaxed">
              Bitcoin payment seen. Your plan activates after one block. You can
              keep using the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearBtcpayConfirmationWatch();
            }}
            className="text-text-secondary hover:text-text hover:bg-surface-hover focus-visible:ring-ring -mt-1 -mr-1 shrink-0 rounded-md p-1.5 focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Dismiss payment notice"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
