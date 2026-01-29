import { useEffect, useState, useRef, useCallback } from 'react';
import { updateLayer, removeLayer } from '../DeckOverlayManager';
import { getKostraCogUrl, KOSTRA_COLOR_SCALE, type KostraDuration, type KostraReturnPeriod } from './RiskLayersConfig';
import { toast } from '@/hooks/use-toast';
import * as GeoTIFF from 'geotiff';

interface KostraLayerProps {
  visible: boolean;
  opacity?: number;
  duration: KostraDuration;
  returnPeriod: KostraReturnPeriod;
}

const LAYER_ID = 'kostra-precipitation';

/**
 * Color mapping function for KOSTRA precipitation values
 * Uses blue-to-purple gradient for rainfall intensity
 */
function precipitationToRGBA(value: number): [number, number, number, number] {
  // NoData or invalid values
  if (value < 0 || !isFinite(value)) {
    return [0, 0, 0, 0];
  }

  // Find color stops
  const stops = KOSTRA_COLOR_SCALE;
  
  // Below minimum
  if (value <= stops[0].value) {
    return hexToRGBA(stops[0].color, 0.1);
  }
  
  // Above maximum
  if (value >= stops[stops.length - 1].value) {
    return hexToRGBA(stops[stops.length - 1].color, 1);
  }
  
  // Interpolate between stops
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].value && value < stops[i + 1].value) {
      const t = (value - stops[i].value) / (stops[i + 1].value - stops[i].value);
      const color1 = hexToRGBA(stops[i].color, 1);
      const color2 = hexToRGBA(stops[i + 1].color, 1);
      
      return [
        Math.round(color1[0] + (color2[0] - color1[0]) * t),
        Math.round(color1[1] + (color2[1] - color1[1]) * t),
        Math.round(color1[2] + (color2[2] - color1[2]) * t),
        255,
      ];
    }
  }
  
  return hexToRGBA(stops[stops.length - 1].color, 1);
}

function hexToRGBA(hex: string, alpha: number): [number, number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0, 0];
  
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
    Math.round(alpha * 255),
  ];
}

/**
 * KostraLayer Component
 * 
 * Renders KOSTRA-DWD-2020 precipitation intensity data as a raster overlay.
 * Uses deck.gl BitmapLayer via DeckOverlayManager singleton.
 */
export default function KostraLayer({
  visible,
  opacity = 0.7,
  duration,
  returnPeriod,
}: KostraLayerProps) {
  const [layerData, setLayerData] = useState<{ image: ImageBitmap; bounds: [number, number, number, number] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const prevScenarioRef = useRef<string>('');
  const loadIdRef = useRef(0);

  // Create scenario key to detect changes
  const scenarioKey = `${duration}-${returnPeriod}`;

  // Load COG when scenario changes
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      return;
    }

    // Skip if scenario unchanged and we have data
    if (scenarioKey === prevScenarioRef.current && layerData) {
      return;
    }

    const loadId = ++loadIdRef.current;
    prevScenarioRef.current = scenarioKey;
    
    loadCOG(loadId);

    return () => {
      // Cleanup on unmount
      removeLayer(LAYER_ID);
    };
  }, [visible, scenarioKey]);

  const loadCOG = useCallback(async (loadId: number) => {
    setIsLoading(true);
    setError(null);
    
    const cogUrl = getKostraCogUrl(duration, returnPeriod);
    console.log(`[KostraLayer] Loading COG: ${cogUrl}`);

    try {
      const response = await fetch(cogUrl);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`KOSTRA-Daten für ${duration}/${returnPeriod} noch nicht verfügbar. Bitte laden Sie die Daten hoch.`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      
      // Check if this load is still current
      if (loadId !== loadIdRef.current) {
        console.log('[KostraLayer] Load superseded, discarding');
        return;
      }

      // Get raster data
      const rasters = await image.readRasters();
      const data = rasters[0] as Float32Array | Float64Array | Int16Array | Int32Array;
      const width = image.getWidth();
      const height = image.getHeight();
      
      // Get bounds from GeoTIFF
      const bbox = image.getBoundingBox();
      const bounds: [number, number, number, number] = [
        bbox[0], // minX (west)
        bbox[1], // minY (south)
        bbox[2], // maxX (east)
        bbox[3], // maxY (north)
      ];
      
      console.log(`[KostraLayer] Loaded: ${width}x${height}, bounds:`, bounds);

      // Create color-mapped image
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;
      
      for (let i = 0; i < data.length; i++) {
        const rgba = precipitationToRGBA(data[i]);
        const offset = i * 4;
        pixels[offset] = rgba[0];
        pixels[offset + 1] = rgba[1];
        pixels[offset + 2] = rgba[2];
        pixels[offset + 3] = rgba[3];
      }

      // Create ImageBitmap for stable WebGL texture
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      
      ctx.putImageData(imageData, 0, 0);
      
      const bitmap = await createImageBitmap(canvas, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });

      // Check again after async
      if (loadId !== loadIdRef.current) {
        bitmap.close();
        return;
      }

      // Close previous bitmap
      if (layerData?.image) {
        try { layerData.image.close(); } catch { /* ignore */ }
      }

      setLayerData({ image: bitmap, bounds });
      setIsLoading(false);
      setError(null);
      
      console.log('[KostraLayer] Ready');

    } catch (err) {
      console.error('[KostraLayer] Load error:', err);
      
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(message);
      setIsLoading(false);
      
      toast({
        title: 'KOSTRA-Daten nicht verfügbar',
        description: message,
        variant: 'destructive',
      });
    }
  }, [duration, returnPeriod, layerData]);

  // Update deck.gl layer when data or opacity changes
  useEffect(() => {
    if (!visible || !layerData) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[KostraLayer] Updating deck layer, opacity:', opacity);

    updateLayer({
      id: LAYER_ID,
      type: 'bitmap',
      visible: true,
      image: layerData.image,
      bounds: layerData.bounds,
      opacity,
    });
  }, [visible, layerData, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
      if (layerData?.image) {
        try { layerData.image.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  return null;
}
