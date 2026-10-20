// Machine options shared by the snapshot builder, the page, and the selftest. v86 restores a state
// correctly only into a machine built with the same options, so all three import this one object.
// No net_device and no network_relay_url: the guest has no network adapter at all.
export const guestOptions = Object.freeze({
  memory_size: 256 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  uart1: true,
  acpi: false,
  disable_speaker: true,
});
