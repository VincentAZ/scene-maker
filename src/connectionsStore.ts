import { useEffect, useState } from "react";
import { api } from "./api";
import type { Provider, ProviderModel } from "../shared/modelChoices";
import type { ConnectionsData } from "./Connections";

// One shared cache for connection status and provider model catalogues, so
// every picker in the studio (menu bar, settings, character details, the
// conversation panel) sees the same data and a provider is discovered once.
type Entry<T> = { revision: number; promise: Promise<T> };
let connections: Entry<ConnectionsData> | null = null;
const catalogs = new Map<Provider, Entry<ProviderModel[]>>();

export function loadConnections(revision: number): Promise<ConnectionsData> {
  if (!connections || connections.revision !== revision) {
    const promise = api<ConnectionsData>("/api/connections");
    const entry = { revision, promise };
    connections = entry;
    promise.catch(() => {
      if (connections === entry) connections = null;
    });
  }
  return connections.promise;
}
export function forgetConnections() {
  connections = null;
}
export function loadCatalog(
  provider: Provider,
  revision: number,
): Promise<ProviderModel[]> {
  const cached = catalogs.get(provider);
  if (cached && cached.revision === revision) return cached.promise;
  const promise = api<{ models: ProviderModel[] }>("/api/connections/models", {
    method: "POST",
    body: JSON.stringify({ provider }),
  }).then((result) => result.models);
  const entry = { revision, promise };
  catalogs.set(provider, entry);
  promise.catch(() => {
    if (catalogs.get(provider) === entry) catalogs.delete(provider);
  });
  return promise;
}
/** A catalogue another screen already discovered (e.g. with a draft key). */
export function primeCatalog(
  provider: Provider,
  models: ProviderModel[],
  revision: number,
) {
  catalogs.set(provider, { revision, promise: Promise.resolve(models) });
}
export function forgetCatalog(provider: Provider) {
  catalogs.delete(provider);
}

export function useConnections(revision: number) {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    loadConnections(revision).then(
      (next) => {
        if (!active) return;
        setData(next);
        setError("");
      },
      (e: Error) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [revision, tick]);
  return {
    data,
    error,
    reload: () => {
      forgetConnections();
      setTick((t) => t + 1);
    },
  };
}

export function useCatalog(
  provider: Provider | null,
  revision: number,
  enabled = true,
) {
  const [state, setState] = useState<{
    provider: Provider | null;
    models: ProviderModel[];
    loading: boolean;
    error: string;
  }>({ provider: null, models: [], loading: false, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!provider || !enabled) {
      setState({ provider: null, models: [], loading: false, error: "" });
      return;
    }
    let active = true;
    setState({ provider, models: [], loading: true, error: "" });
    loadCatalog(provider, revision).then(
      (models) => {
        if (active) setState({ provider, models, loading: false, error: "" });
      },
      (e: Error) => {
        if (active)
          setState({ provider, models: [], loading: false, error: e.message });
      },
    );
    return () => {
      active = false;
    };
  }, [provider, revision, enabled, tick]);
  return {
    ...state,
    refresh: () => {
      if (provider) forgetCatalog(provider);
      setTick((t) => t + 1);
    },
  };
}
