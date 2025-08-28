(function () {
  // (Optional) restrict which parent origins are allowed
  const TRUSTED_PARENTS = [
    "https://www.bangkokhospital.com",
    "https://bangkokhospital.com",
    // add more allowed hosts as needed
  ];

  let parentHref = null;
  let parentOrigin = null;

  // Listen for host-info from the parent page
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type !== "host-info") return;

    // If you maintain a strict allowlist, enforce it:
    if (TRUSTED_PARENTS.length && !TRUSTED_PARENTS.includes(event.origin)) {
      return; // ignore untrusted parent
    }

    if (typeof data.href === "string") {
      parentHref = data.href;
      sessionStorage.setItem("parentHref", parentHref);
    }
    parentOrigin = event.origin;
    sessionStorage.setItem("parentOrigin", parentOrigin);
  });

  // Ask parent explicitly (covers cases where it hasn't sent info yet)
  function requestHostInfo() {
    try {
      window.parent.postMessage({ type: "request-host-info" }, "*");
    } catch {}
  }

  // Initial requests + a retry
  requestHostInfo();
  setTimeout(requestHostInfo, 600);

  // Helper your logger can call
  window.getBestHostUrl = function getBestHostUrl() {
    return (
      parentHref ||
      sessionStorage.getItem("parentHref") ||
      document.referrer ||                                   // fallback if allowed
      new URLSearchParams(location.search).get("host") ||    // last-ditch query fallback
      null
    );
  };
})();
