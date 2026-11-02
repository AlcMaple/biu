import ReviewTab from "@/components/lyrics-align-modal/review-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsReview = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-2">
      <h1>歌词审核</h1>
    </div>
    <ReviewTab />
  </ScrollContainer>
);

export default LyricsReview;
