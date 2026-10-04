<script setup lang="ts">
defineProps<{ total: number; current: number }>();
</script>

<template>
  <div class="dots" aria-hidden="true">
    <span
      v-for="index in total"
      :key="index"
      class="dot"
      :class="{ active: index - 1 === current, done: index - 1 < current }"
    />
  </div>
</template>
