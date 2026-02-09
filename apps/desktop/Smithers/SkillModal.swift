import Foundation

enum SkillModal: Identifiable {
    case browse
    case manage
    case use
    case create
    case detail(SkillItem)

    var id: String {
        switch self {
        case .browse:
            return "browse"
        case .manage:
            return "manage"
        case .use:
            return "use"
        case .create:
            return "create"
        case .detail(let skill):
            return "detail-\(skill.id)"
        }
    }
}
