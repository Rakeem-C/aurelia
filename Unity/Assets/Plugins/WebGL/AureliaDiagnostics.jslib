mergeInto(LibraryManager.library, {
  ReportUnityState: function(frame, count) {
    var canvas = document.getElementById('battlefield');
    if (canvas) { canvas.dataset.unityFrames=String(frame); canvas.dataset.unityActors=String(count); }
  }
});
