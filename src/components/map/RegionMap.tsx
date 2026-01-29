import React, { useRef, useEffect, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { supabase } from "@/integrations/supabase/client";
import { useRegion, Region } from "@/contexts/RegionContext";
import { useMapLayers } from "./MapLayersContext";
import { useMapOverlays } from "@/hooks/useMapOverlays";
import { useDwdTemperature } from "@/hooks/useDwdTemperature";
import { getBasemapStyle } from "./basemapStyles";

import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

import LayersControl from "./LayersControl";
import { GlobalLSTOverlay } from "./GlobalLSTOverlay";
import { AirTemperatureOverlay } from "./AirTemperatureOverlay";
import { AirTemperatureLegend } from "./AirTemperatureLegend";
import { DwdTemperatureHealthCheck } from "./DwdTemperatureHealthCheck";
import { EcostressCompositeOverlay, type GranuleData } from "./ecostress";

import { initDeckOverlay, finalizeDeckOverlay } from "./DeckOverlayManager";

const REGIONS_FETCH_TIMEOUT_MS = 10000;
const isDev = import.meta.env.DEV;

const RegionMap: React.FC = () => {
  const { isAdmin } = useAuth();

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { regions, setRegions, selectedRegionId, setSelectedRegionId, hoveredRegionId, setHoveredRegionId } =
    useRegion();

  const { basemap, overlays, heatLayers, airTemperature } = useMapLayers();

  const anyOverlayEnabled = overlays.ecostress.enabled || overlays.floodRisk.enabled || airTemperature.enabled;

  const heatOverlayEnabled = overlays.ecostress.enabled;

  // Data hooks
  useMapOverlays();
  useDwdTemperature();

  // -------------------------
  // Fetch regions
  // -------------------------
  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), REGIONS_FETCH_TIMEOUT_MS),
    );

    try {
      const fetchPromise = supabase.from("regions").select("id, name, geom");

      const { data, error } = (await Promise.race([fetchPromise, timeout])) as Awaited<typeof fetchPromise>;

      if (error) throw error;

      const parsed: Region[] = (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        geom: typeof r.geom === "string" ? JSON.parse(r.geom) : r.geom,
      }));

      setRegions(parsed);
    } catch (err) {
      setError("Fehler beim Laden der Regionen");
      setRegions([]);
    } finally {
      setLoading(false);
    }
  }, [setRegions]);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // -------------------------
  // Init Map
  // -------------------------
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: getBasemapStyle(basemap),
      center: [10.4515, 51.1657],
      zoom: 5,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      if (map.current) {
        initDeckOverlay(map.current, import.meta.env.DEV);
      }
      setMapReady(true);
    });

    return () => {
      finalizeDeckOverlay();
      map.current?.remove();
      map.current = null;
      setMapReady(false);
    };
  }, []);

  // -------------------------
  // Basemap switch
  // -------------------------
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const center = map.current.getCenter();
    const zoom = map.current.getZoom();

    map.current.setStyle(getBasemapStyle(basemap));

    map.current.once("style.load", () => {
      if (!map.current) return;
      map.current.setCenter(center);
      map.current.setZoom(zoom);
      initDeckOverlay(map.current, import.meta.env.DEV, { force: true });
      map.current.resize();
    });
  }, [basemap, mapReady]);

  // -------------------------
  // Regions rendering
  // -------------------------
  useEffect(() => {
    if (!map.current || !mapReady || regions.length === 0) return;

    const m = map.current;

    if (m.getSource("regions")) {
      ["regions-fill", "regions-outline", "regions-highlight"].forEach((id) => {
        if (m.getLayer(id)) m.removeLayer(id);
      });
      m.removeSource("regions");
    }

    m.addSource("regions", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: regions.map((r) => ({
          type: "Feature",
          id: r.id,
          properties: { id: r.id, name: r.name },
          geometry: r.geom,
        })),
      },
    });

    m.addLayer({
      id: "regions-fill",
      type: "fill",
      source: "regions",
      paint: {
        "fill-color": "#00ff00",
        "fill-opacity": anyOverlayEnabled ? 0.3 : 0.8,
      },
    });

    m.addLayer({
      id: "regions-outline",
      type: "line",
      source: "regions",
      paint: {
        "line-color": "#00ff00",
        "line-width": 1,
      },
    });
  }, [regions, mapReady, anyOverlayEnabled]);

  // -------------------------
  // Error state
  // -------------------------
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <p className="text-destructive">{error}</p>
          <Button onClick={fetchRegions} className="mt-4">
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />

      <LayersControl />

      {mapReady && map.current && airTemperature.enabled && (
        <AirTemperatureOverlay
          map={map.current}
          visible
          opacity={airTemperature.opacity / 100}
          data={airTemperature.data}
        />
      )}

      <AirTemperatureLegend
        visible={airTemperature.enabled}
        normalization={airTemperature.metadata?.normalization || null}
        aggregation={airTemperature.aggregation}
        year={airTemperature.metadata?.year}
        period={airTemperature.metadata?.period}
        pointCount={airTemperature.metadata?.pointCount}
        loading={airTemperature.loading}
        error={airTemperature.error}
      />

      <DwdTemperatureHealthCheck visible={isDev || isAdmin} />

      {mapReady && map.current && heatOverlayEnabled && (
        <GlobalLSTOverlay
          map={map.current}
          visible={heatLayers.globalLSTEnabled}
          opacity={heatLayers.globalLSTOpacity / 100}
        />
      )}

      {mapReady && map.current && overlays.ecostress.enabled && (
        <EcostressCompositeOverlay
          map={map.current}
          visible
          opacity={heatLayers.ecostressOpacity / 100}
          allGranules={overlays.ecostress.metadata?.allGranules as GranuleData[] | undefined}
          regionBbox={overlays.ecostress.metadata?.regionBbox as [number, number, number, number] | undefined}
          aggregationMethod={heatLayers.aggregationMethod}
        />
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p>Lade Karte…</p>
        </div>
      )}
    </div>
  );
};

export default RegionMap;
