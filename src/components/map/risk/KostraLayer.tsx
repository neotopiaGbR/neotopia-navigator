import { useEffect, useState, useRef, useCallback } from 'react';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
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

// Germany bounding box for tile constraints
const GERMANY_BOUNDS = {
  west: 5.87,
  south: 47.27,
  east: 15.04,
  north: 55.06,
};

/**
 * Color mapping function for KOSTRA precipitation values
 * Uses blue-to-purple gradient for rainfall intensity
 */
function precipitationToRGBA(value: number): [number, number, number, number] {
  // NoData or invalid values
  if (value < 0 || !isFinite(value)) {
    return [0, 0, 0, 0];
  }

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
 * Load a windowed portion of a COG using HTTP Range Requests.
 * This fetches only the pixels for the requested bounding box.
 */
async function loadCogWindow(
  cogUrl: string,
  tileBounds: { west: number; south: number; east: number; north: number },
  tileSize: number = 256
): Promise<{ image: ImageBitmap; bounds: [number, number, number, number] } | null> {
  try {
    // Open COG with HTTP Range Request support
    const tiff = await GeoTIFF.fromUrl(cogUrl, {
      allowFullFile: false, // Only use Range Requests
    });
    
    const image = await tiff.getImage();
    const imageBounds = image.getBoundingBox();
    
    // Check if tile intersects image bounds
    if (tileBounds.east < imageBounds[0] || tileBounds.west > imageBounds[2] ||
        tileBounds.north < imageBounds[1] || tileBounds.south > imageBounds[3]) {
      return null; // No intersection
    }
    
    // Calculate pixel window for the tile
    const imageWidth = image.getWidth();
    const imageHeight = image.getHeight();
    const resolution = image.getResolution();
    
    // Clamp to image bounds
    const clampedWest = Math.max(tileBounds.west, imageBounds[0]);
    const clampedSouth = Math.max(tileBounds.south, imageBounds[1]);
    const clampedEast = Math.min(tileBounds.east, imageBounds[2]);
    const clampedNorth = Math.min(tileBounds.north, imageBounds[3]);
    
    // Convert geo coords to pixel coords
    const x0 = Math.floor((clampedWest - imageBounds[0]) / Math.abs(resolution[0]));
    const y0 = Math.floor((imageBounds[3] - clampedNorth) / Math.abs(resolution[1]));
    const x1 = Math.ceil((clampedEast - imageBounds[0]) / Math.abs(resolution[0]));
    const y1 = Math.ceil((imageBounds[3] - clampedSouth) / Math.abs(resolution[1]));
    
    // Clamp to image dimensions
    const window = [
      Math.max(0, Math.min(x0, imageWidth - 1)),
      Math.max(0, Math.min(y0, imageHeight - 1)),
      Math.max(0, Math.min(x1, imageWidth)),
      Math.max(0, Math.min(y1, imageHeight)),
    ] as [number, number, number, number];
    
    // Read only the windowed portion (this is where Range Requests happen)
    const rasters = await image.readRasters({
      window,
      width: tileSize,
      height: tileSize,
      resampleMethod: 'bilinear',
    });
    
    const data = rasters[0] as Float32Array | Float64Array | Int16Array | Int32Array;
    
    // Create color-mapped image
    const imageData = new ImageData(tileSize, tileSize);
    const pixels = imageData.data;
    
    for (let i = 0; i < data.length; i++) {
      const rgba = precipitationToRGBA(data[i]);
      const offset = i * 4;
      pixels[offset] = rgba[0];
      pixels[offset + 1] = rgba[1];
      pixels[offset + 2] = rgba[2];
      pixels[offset + 3] = rgba[3];
    }

    // Create ImageBitmap
    const canvas = document.createElement('canvas');
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.putImageData(imageData, 0, 0);
    
    const bitmap = await createImageBitmap(canvas, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });

    return {
      image: bitmap,
      bounds: [clampedWest, clampedSouth, clampedEast, clampedNorth],
    };
    
  } catch (err) {
    console.warn(`[KostraLayer] Failed to load tile:`, err);
    return null;
  }
}

/**
 * KostraLayer Component - Virtual Tiling Edition
 * 
 * Renders KOSTRA-DWD-2020 precipitation intensity data using deck.gl TileLayer.
 * Loads only visible tiles via HTTP Range Requests on Cloud Optimized GeoTIFF.
 * 
 * Benefits:
 * - Browser downloads only visible portions of the COG
 * - Efficient zoom-level rendering via internal COG overviews
 * - No tile server required - works with static hosting
 */
export default function KostraLayer({
  visible,
  opacity = 0.7,
  duration,
  returnPeriod,
}: KostraLayerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cogUrl, setCogUrl] = useState<string>('');
  
  const prevScenarioRef = useRef<string>('');
  const cogValidRef = useRef<boolean>(false);

  // Create scenario key to detect changes
  const scenarioKey = `${duration}-${returnPeriod}`;

  // Update COG URL when scenario changes
  useEffect(() => {
    if (!visible) {
      removeLayer(LAYER_ID);
      cogValidRef.current = false;
      return;
    }

    const newUrl = getKostraCogUrl(duration, returnPeriod);
    setCogUrl(newUrl);
    
    // Verify COG is accessible
    if (scenarioKey !== prevScenarioRef.current) {
      prevScenarioRef.current = scenarioKey;
      verifyCog(newUrl);
    }
  }, [visible, scenarioKey, duration, returnPeriod]);

  const verifyCog = useCallback(async (url: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Quick HEAD request to verify COG exists
      const response = await fetch(url, { method: 'HEAD' });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`KOSTRA-Daten für ${duration}/${returnPeriod} nicht verfügbar`);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      // Verify Range Request support
      const acceptRanges = response.headers.get('accept-ranges');
      if (acceptRanges !== 'bytes') {
        console.warn('[KostraLayer] Server may not support Range Requests');
      }
      
      cogValidRef.current = true;
      setIsLoading(false);
      console.log(`[KostraLayer] COG verified: ${url}`);
      
    } catch (err) {
      console.error('[KostraLayer] COG verification failed:', err);
      cogValidRef.current = false;
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setIsLoading(false);
      
      toast({
        title: 'KOSTRA-Daten nicht verfügbar',
        description: err instanceof Error ? err.message : 'Laden fehlgeschlagen',
        variant: 'destructive',
      });
    }
  }, [duration, returnPeriod]);

  // Register TileLayer with DeckOverlayManager
  useEffect(() => {
    if (!visible || !cogUrl || !cogValidRef.current) {
      removeLayer(LAYER_ID);
      return;
    }

    console.log('[KostraLayer] Registering TileLayer for COG:', cogUrl);

    // Create a TileLayer that loads COG windows on demand
    updateLayer({
      id: LAYER_ID,
      type: 'tile',
      visible: true,
      opacity,
      tileUrl: cogUrl,
      tileBounds: GERMANY_BOUNDS,
      tileSize: 256,
      minZoom: 5,
      maxZoom: 14,
      // Pass the tile loader function reference
      loadTile: async (tile: { bbox: { west: number; south: number; east: number; north: number }; z: number }) => {
        return loadCogWindow(cogUrl, tile.bbox, 256);
      },
    } as any);
    
  }, [visible, cogUrl, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeLayer(LAYER_ID);
    };
  }, []);

  return null;
}
