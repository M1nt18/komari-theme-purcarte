import {
  useState,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { getWsService } from "../services/api";
import { useNodeData } from "./NodeDataContext";
import type { RpcNodeStatusMap } from "../types/rpc";

export interface LiveDataContextType {
  liveData: RpcNodeStatusMap | null;
}

const LiveDataContext = createContext<LiveDataContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useLiveData = () => {
  const context = useContext(LiveDataContext);
  if (!context) {
    throw new Error("useLiveData must be used within a LiveDataProvider");
  }
  return context;
};

interface LiveDataProviderProps {
  children: ReactNode;
  enableWebSocket?: boolean;
}

export const LiveDataProvider = ({
  children,
  enableWebSocket = true,
}: LiveDataProviderProps) => {
  const [liveData, setLiveData] = useState<RpcNodeStatusMap | null>(null);
  const { loading } = useNodeData();
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  useEffect(() => {
    if (!loading && !initialLoadComplete) {
      setInitialLoadComplete(true);
    }
  }, [loading, initialLoadComplete]);

  useEffect(() => {
    if (initialLoadComplete && enableWebSocket) {
      const wsService = getWsService();

      const handleWebSocketData = (data: any) => {
        setLiveData(data as RpcNodeStatusMap);
      };

      const unsubscribe = wsService.subscribe(handleWebSocketData);
      wsService.connect();

      return () => {
        unsubscribe();
        wsService.disconnect();
      };
    } else {
      const wsService = getWsService();
      wsService.disconnect();
      setLiveData(null);
    }
  }, [initialLoadComplete, enableWebSocket]);

  return (
    <LiveDataContext.Provider value={{ liveData }}>
      {children}
    </LiveDataContext.Provider>
  );
};
