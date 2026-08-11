<script setup>
defineProps({
  maxWidth: { type: [String, Number], default: 480 },
});
defineEmits(['close']);
</script>

<template>
  <v-dialog :model-value="true" :max-width="maxWidth" scrollable @update:model-value="$emit('close')">
    <v-card>
      <v-card-text>
        <slot />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
