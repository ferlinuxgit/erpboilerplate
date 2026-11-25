"use client";

import { useEffect, useRef, useState } from "react";

import { NO_CUSTOMER_PRICING, type CustomerPricing } from "@/lib/pricing";

/**
 * Tarifa y descuento de grupo del cliente elegido (para proponer precios al elegir artículos).
 * `onLoad` se llama cada vez que llegan los precios de un cliente: sirve para recalcular las líneas
 * cuando el usuario cambia de cliente.
 */
export function useCustomerPricing(customerId: string | null | undefined, onLoad?: (pricing: CustomerPricing, customerId: string) => void) {
  const [loaded, setLoaded] = useState<{ customerId: string; pricing: CustomerPricing } | null>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    if (!customerId) return;
    let ignore = false;
    fetch(`/api/customers/${encodeURIComponent(customerId)}/pricing`)
      .then((response) => (response.ok ? (response.json() as Promise<CustomerPricing>) : NO_CUSTOMER_PRICING))
      .catch(() => NO_CUSTOMER_PRICING)
      .then((pricing) => {
        if (ignore) return;
        setLoaded({ customerId, pricing });
        onLoadRef.current?.(pricing, customerId);
      });
    return () => {
      ignore = true;
    };
  }, [customerId]);

  const ready = Boolean(customerId) && loaded?.customerId === customerId;
  return { pricing: ready && loaded ? loaded.pricing : NO_CUSTOMER_PRICING, ready };
}
