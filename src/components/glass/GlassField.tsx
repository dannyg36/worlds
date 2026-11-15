import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { color, fontFamily, radius, space } from "@/design/tokens";

export function GlassField({ style, multiline, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.focused]}>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={color.textTertiary}
        keyboardAppearance="dark"
        selectionColor={color.lilac}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, multiline && styles.multiline, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  focused: {
    borderColor: "rgba(201, 184, 255, 0.55)",
    boxShadow: "0 0 0 4px rgba(139, 108, 255, 0.18)",
  },
  input: {
    fontFamily: fontFamily.system,
    fontSize: 18,
    lineHeight: 24,
    minHeight: 28,
    color: color.text,
    outlineStyle: "none",
  } as object,
  multiline: {
    minHeight: 120,
    maxHeight: 220,
    lineHeight: 26,
    paddingVertical: space.xs,
    textAlignVertical: "top",
  },
});
