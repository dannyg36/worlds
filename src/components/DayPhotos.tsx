import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Id } from "../../convex/_generated/dataModel";

/** As many photos as worlds.add takes. */
export const MAX_PHOTOS = 6;
// Claude reads a photo this size without scaling it down, and as a JPEG it
// stays far under the 3.75 MB worlds.add allows.
const MAX_EDGE = 1568;

const icons = {
  add: {
    ios: "photo.badge.plus",
    android: "add_photo_alternate",
    web: "add_photo_alternate",
  },
  remove: { ios: "xmark", android: "close", web: "close" },
} satisfies Record<string, SymbolViewProps["name"]>;

type Props = {
  /** Local URIs of the photos, already shrunk to JPEGs, in the order they were added. */
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
};

/** Photos to go with the day: a tile that opens the photo library, then a row of thumbnails. */
export function DayPhotos({ photos, onChange, disabled = false }: Props) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const locked = disabled || adding;

  async function add() {
    const room = MAX_PHOTOS - photos.length;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
      orderedSelection: true,
    });
    if (result.canceled) {
      return;
    }
    setAdding(true);
    const added: string[] = [];
    let failed = 0;
    // One at a time: decoding a full-size photo takes a lot of memory.
    for (const asset of result.assets.slice(0, room)) {
      try {
        added.push(await shrink(asset.uri));
      } catch {
        failed += 1;
      }
    }
    onChange([...photos, ...added]);
    setAdding(false);
    if (failed > 0) {
      Alert.alert(
        failed === 1 ? "Couldn't add a photo" : `Couldn't add ${failed} photos`,
        "Try picking it again, or choose a different one.",
      );
    }
  }

  const addTile = (
    <View style={[styles.tile, styles.addTile, { backgroundColor: colors.border }]}>
      {adding ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <SymbolView name={icons.add} size={24} tintColor={colors.primary} />
      )}
    </View>
  );

  if (photos.length === 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: locked }}
        disabled={locked}
        onPress={add}
        style={styles.empty}
      >
        {addTile}
        <View style={styles.emptyText}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Add photos</Text>
          <Text style={styles.emptyHint}>
            They’ll show up where they belong in your world.
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.row}
    >
      {photos.map((uri, index) => (
        <View key={uri} style={styles.tile}>
          <Image
            source={{ uri }}
            style={styles.photo}
            contentFit="cover"
            accessibilityLabel={`Photo ${index + 1}`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${index + 1}`}
            disabled={locked}
            hitSlop={8}
            onPress={() => onChange(photos.filter((photo) => photo !== uri))}
            style={styles.remove}
          >
            <SymbolView name={icons.remove} size={10} weight="bold" tintColor="#FFFFFF" />
          </Pressable>
        </View>
      ))}
      {photos.length < MAX_PHOTOS ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={add}
        >
          {addTile}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/** Re-encodes a picked photo (often HEIC, often huge) as a JPEG no longer than MAX_EDGE. */
async function shrink(uri: string) {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const long = Math.max(original.width, original.height);
  const image =
    long > MAX_EDGE
      ? await ImageManipulator.manipulate(original)
          .resize(
            original.width >= original.height
              ? { width: MAX_EDGE }
              : { height: MAX_EDGE },
          )
          .renderAsync()
      : original;
  try {
    const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return saved.uri;
  } finally {
    original.release();
    if (image !== original) {
      image.release();
    }
  }
}

/** Uploads the photos to Convex storage and returns their storage ids, in order. */
export async function uploadPhotos(
  photos: string[],
  uploadUrl: () => Promise<string>,
): Promise<Id<"_storage">[]> {
  return await Promise.all(
    photos.map(async (uri) => {
      const response = await fetch(await uploadUrl(), {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: await (await fetch(uri)).blob(),
      });
      if (!response.ok) {
        throw new Error(`A photo didn't upload (${response.status}).`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      return storageId;
    }),
  );
}

const TILE = 72;

const styles = StyleSheet.create({
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  emptyText: {
    flex: 1,
    gap: 2,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  emptyHint: {
    color: "#8E8E93",
    fontSize: 15,
    lineHeight: 20,
  },
  // A ScrollView grows to fill its parent by default, which would push the
  // record sheet's button to the bottom.
  strip: {
    flexGrow: 0,
  },
  row: {
    gap: 10,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  addTile: {
    alignItems: "center",
    justifyContent: "center",
  },
  photo: {
    width: TILE,
    height: TILE,
  },
  remove: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
});
