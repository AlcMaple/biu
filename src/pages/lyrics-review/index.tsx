import ReviewTab from "@/components/lyrics-align-modal/review-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsReview = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-2">
      <h1>歌词审核</h1>
      <p className="text-foreground-500 mt-1 text-sm">
        大家提交的逐字歌词，先交的排在前面。播放试听后再决定：通过后对这首歌的所有人生效；打回要写原因，提交的人能看到
      </p>
    </div>
    <ReviewTab />
  </ScrollContainer>
);

export default LyricsReview;
