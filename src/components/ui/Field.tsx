import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { color, font, radius, space } from "@/design/tokens";

export function Field({ style, multiline, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.focused]}>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={color.inkTertiary}
        keyboardAppearance="light"
        selectionColor={color.ink}
        cursorColor={color.ink}
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
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.03)",
  },
  focused: {
    borderColor: "rgba(0, 0, 0, 0.38)",
    boxShadow: "0 0 0 4px rgba(0, 0, 0, 0.04)",
  },
  input: {
    fontFamily: font.sans,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 24,
    padding: 0,
    color: color.ink,
    outlineStyle: "none",
  } as object,
  multiline: {
    minHeight: 132,
    maxHeight: 260,
    textAlignVertical: "top",
  },
});
