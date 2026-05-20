"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

type LatLng = [number, number];

type Props = {
  points: LatLng[];
  onChange: (points: LatLng[]) => void;
  initialCenter?: LatLng;
  initialZoom?: number;
};

const vertexIcon = L.divIcon({
  className: "",
  html: `<div style="width:12px;height:12px;background:#10b981;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

function ClickCapture({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

export default function PolygonMapPicker({
  points,
  onChange,
  initialCenter,
  initialZoom,
}: Props) {
  // Suppress Leaflet's broken-image default icon warning in Next.js
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({ iconUrl: "", shadowUrl: "" });
  }, []);

  function addPoint(p: LatLng) {
    onChange([...points, p]);
  }

  return (
    <MapContainer
      center={initialCenter ?? [31.5, -7.5]}
      zoom={initialZoom ?? 8}
      style={{
        height: "380px",
        borderRadius: "8px",
        border: "1px solid #d1d5db",
        cursor: "crosshair",
      }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <ClickCapture onAdd={addPoint} />

      {points.length >= 3 && (
        <Polygon
          positions={points}
          pathOptions={{
            color: "#10b981",
            fillColor: "#10b981",
            fillOpacity: 0.15,
            weight: 2,
          }}
        />
      )}

      {points.map((pt, i) => (
        <Marker key={i} position={pt} icon={vertexIcon} />
      ))}
    </MapContainer>
  );
}
