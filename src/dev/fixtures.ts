import { useEffect, useRef, useState } from "react";

import type { FeedWorld } from "@/components/WorldFeed";
import type { WorldStatus } from "@/components/WorldCard";

const hour = 60 * 60 * 1000;
const day = 24 * hour;

const images = [
  require("@/assets/fixtures/world-1.jpg"),
  require("@/assets/fixtures/world-2.jpg"),
  require("@/assets/fixtures/world-3.jpg"),
  require("@/assets/fixtures/world-4.jpg"),
  require("@/assets/fixtures/world-5.jpg"),
  require("@/assets/fixtures/world-6.jpg"),
];

function seed(now: number): FeedWorld[] {
  return [
    {
      id: "f1",
      createdAt: now - 3 * 60 * 1000,
      status: "sculpting",
      title: "Northern lights over the trailhead",
      transcript:
        "Drove up after work with Leo, hiked the last mile in the dark, and the sky just lit up green over the lake. Couldn't stop laughing.",
      palette: ["#5BE3D4", "#8B6CFF", "#FF9A7A"],
      image: images[5],
    },
    {
      id: "f2",
      createdAt: now - day,
      status: "ready",
      title: "Rooftop pizza with Sam",
      caption: "String lights, a too-big pizza, and the whole skyline humming.",
      palette: ["#FFB46B", "#FF7EB6", "#6E8BFF"],
      image: images[0],
      shared: true,
    },
    {
      id: "f3",
      createdAt: now - 2 * day,
      status: "dreaming",
      transcript: "Quiet one. Read on the couch most of the afternoon, made soup, called mom.",
      palette: ["#C9B8FF", "#FF9A7A", "#5BE3D4"],
    },
    {
      id: "f4",
      createdAt: now - 3 * day,
      status: "ready",
      title: "The Raindrop Café",
      caption: "Rain on the glass, a flat white, and the deck finally done.",
      palette: ["#F2C38B", "#5C8F7A", "#2E3A66"],
      image: images[1],
    },
    {
      id: "f5",
      createdAt: now - 4 * day,
      status: "ready",
      title: "Cherry blossom fetch",
      caption: "Biscuit learned to catch the frisbee. Mostly.",
      palette: ["#FFB7D5", "#9BD88F", "#FFE7A3"],
      image: images[2],
      author: "Sam",
    },
    {
      id: "f6",
      createdAt: now - 6 * day,
      status: "failed",
      transcript: "Conference day. Way too much coffee, met a founder building robot gardens.",
      error: "The scene writer timed out. Your words are safe.",
      palette: ["#FF8A8A", "#8B6CFF"],
    },
    {
      id: "f7",
      createdAt: now - 7 * day,
      status: "painting",
      transcript: "Farmers market, then soldering the lamp kit with Priya until midnight.",
      palette: ["#FFD36E", "#FF7EB6", "#5BE3D4"],
    },
    {
      id: "f8",
      createdAt: now - 32 * day,
      status: "ready",
      title: "Glass waves at Ocean Beach",
      caption: "Bonfire, a borrowed board, and the coldest water of my life.",
      palette: ["#3FD0C9", "#FF9A5C", "#2B3F8F"],
      image: images[3],
    },
    {
      id: "f9",
      createdAt: now - 34 * day,
      status: "ready",
      title: "The library tower",
      caption: "Finished the whole book in one sitting. The cat approved.",
      palette: ["#FFB25C", "#5E7A4B", "#3B2A60"],
      image: images[4],
      author: "Priya",
    },
    {
      id: "f10",
      createdAt: now - 36 * day,
      transcript:
        "First night trying this. Long day of interviews, then tacos with the team and a walk along the water. Feeling hopeful.",
    },
  ];
}

const forming: WorldStatus[] = ["queued", "dreaming", "painting", "sculpting", "ready"];

export function useFixtureWorlds() {
  const [worlds, setWorlds] = useState<FeedWorld[]>(() => seed(Date.now()));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function update(id: string, patch: Partial<FeedWorld>) {
    setWorlds((current) => current.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }

  async function add(transcript: string) {
    const id = `local-${Date.now()}`;
    setWorlds((current) => [
      { id, createdAt: Date.now(), transcript: transcript.trim(), status: "queued", palette: ["#8B6CFF", "#5BE3D4", "#FF7EB6"] },
      ...current,
    ]);
    forming.slice(1).forEach((status, i) => {
      timers.current.push(
        setTimeout(() => {
          update(id, {
            status,
            ...(status === "painting" ? { title: "A night you told me about" } : {}),
            ...(status === "sculpting" ? { image: images[(Date.now() / 1000) % images.length | 0] } : {}),
          });
        }, (i + 1) * 3500),
      );
    });
  }

  function toggleShare(id: string) {
    setWorlds((current) => current.map((w) => (w.id === id ? { ...w, shared: !w.shared } : w)));
  }

  function retry(id: string) {
    update(id, { status: "dreaming", error: undefined });
  }

  return { worlds, add, toggleShare, retry };
}
