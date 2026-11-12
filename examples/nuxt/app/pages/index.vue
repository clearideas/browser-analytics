<script setup>
const { $analytics } = useNuxtApp()
const track = () => $analytics.trackEvent('cta_click', { framework: 'nuxt' })
</script>

<template>
  <main>
    <h1>Home</h1>
    <NuxtLink id="nav-pricing" to="/pricing">Pricing</NuxtLink>
    <button id="cta" @click="track">Track CTA</button>
  </main>
</template>
