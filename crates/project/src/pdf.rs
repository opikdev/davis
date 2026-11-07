use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};

const A4_LANDSCAPE: (f32, f32) = (842.0, 595.0);
const IMAGE_NAME: Name = Name(b"Page");

pub struct PageImage {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

// A row taller than the sheet shrinks to fit rather than running off the page.
fn placement(image: &PageImage) -> (f32, f32, f32, f32) {
    let (page_width, page_height) = A4_LANDSCAPE;
    let (width, height) = (image.width as f32, image.height as f32);
    let scale = (page_width / width).min(page_height / height);
    let (shown_width, shown_height) = (width * scale, height * scale);
    (
        (page_width - shown_width) / 2.0,
        page_height - shown_height,
        shown_width,
        shown_height,
    )
}

pub fn images_to_pdf(pages: &[PageImage]) -> Vec<u8> {
    let catalog = Ref::new(1);
    let tree = Ref::new(2);
    let reference = |page: usize, offset: i32| Ref::new(3 + 3 * page as i32 + offset);

    let mut pdf = Pdf::new();
    pdf.catalog(catalog).pages(tree);
    pdf.pages(tree)
        .kids((0..pages.len()).map(|page| reference(page, 0)))
        .count(pages.len() as i32);

    for (index, image) in pages.iter().enumerate() {
        let (page_ref, content_ref, image_ref) = (
            reference(index, 0),
            reference(index, 1),
            reference(index, 2),
        );
        let (page_width, page_height) = A4_LANDSCAPE;
        let mut page = pdf.page(page_ref);
        page.media_box(Rect::new(0.0, 0.0, page_width, page_height));
        page.parent(tree);
        page.contents(content_ref);
        page.resources().x_objects().pair(IMAGE_NAME, image_ref);
        page.finish();

        let (x, y, width, height) = placement(image);
        let mut content = Content::new();
        content.save_state();
        content.transform([width, 0.0, 0.0, height, x, y]);
        content.x_object(IMAGE_NAME);
        content.restore_state();
        pdf.stream(content_ref, &content.finish());

        let mut xobject = pdf.image_xobject(image_ref, &image.jpeg);
        xobject.filter(Filter::DctDecode);
        xobject.width(image.width as i32);
        xobject.height(image.height as i32);
        xobject.color_space().device_rgb();
        xobject.bits_per_component(8);
        xobject.finish();
    }
    pdf.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: u32, height: u32) -> PageImage {
        PageImage {
            jpeg: vec![0xFF, 0xD8, 0xFF, 0xD9],
            width,
            height,
        }
    }

    fn count(haystack: &[u8], needle: &[u8]) -> usize {
        haystack
            .windows(needle.len())
            .filter(|window| *window == needle)
            .count()
    }

    #[test]
    fn each_image_becomes_its_own_page() {
        let pdf = images_to_pdf(&[image(1200, 800), image(1200, 400)]);

        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(count(&pdf, b"/Type /Page\n"), 2);
        assert_eq!(count(&pdf, b"/Subtype /Image"), 2);
    }

    #[test]
    fn a_wide_image_fills_the_width_from_the_top() {
        assert_eq!(placement(&image(1684, 595)), (0.0, 297.5, 842.0, 297.5));
    }

    #[test]
    fn a_tall_image_shrinks_to_fit_the_page() {
        let (x, y, width, height) = placement(&image(595, 1190));

        assert_eq!((y, height), (0.0, 595.0));
        assert_eq!(width, 297.5);
        assert_eq!(x, 272.25);
    }
}
