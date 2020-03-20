import oid from 'bson-objectid';
import AJV from 'ajv';
import {ValidationError} from './errors';
import {SCHEMAS} from './schema';
import {Export, Query} from './interfaces';
import {generateCourseQuery} from './generators';

const VALID_SETTINGS = new Set(['previous_notification', 'tour', 'redirectFromHome']);

export const validator = new AJV();
validator.addSchema(SCHEMAS);

export interface ImportOptions {
	maxCoursesPerSemester?: number;
	maxCategoriesPerCourse?: number;
	maxGradesPerCategory?: number;
	gid: string;
}

export function coerceJSON(payload: Buffer | string | object, name = 'input'): object {
	let coerced;

	if (typeof payload === 'string' || payload instanceof Buffer) {
		try {
			coerced = JSON.parse(payload.toString());
		} catch (error) {
			throw new ValidationError({
				message: `Unable to parse ${name}`,
				originalError: error
			});
		}
	}

	return coerced || payload;
}

// @TODO: validate remaining fields!
export function validateUser(user: Export['user']): void {
	const settings = coerceJSON(user.settings, 'settings');
	for (const key of Object.keys(settings)) {
		if (!VALID_SETTINGS.has(key)) {
			throw new ValidationError({message: `Unknown setting: ${key}`});
		}
	}

	const formattedDate = new Date().toISOString().slice(0, 20) + '000Z';

	if (!user.created_at) {
		user.created_at = formattedDate;
	}

	if (!user.updated_at) {
		user.updated_at = formattedDate;
	}
}

export function runBasicValidations(payload: Buffer | string | object): Export {
	payload = coerceJSON(payload);
	const passesBasicValidations = validator.validate('gradebook-v0-import', payload);

	if (!passesBasicValidations) {
		const paths = new Set<string>();
		let message = 'Export is invalid:';

		for (const error of validator.errors) {
			if (!paths.has(error.dataPath)) {
				message += `\n\t${error.dataPath} ${error.message}`;
				paths.add(error.dataPath);
			}
		}

		throw new ValidationError({message});
	}

	// Note: once the payload passes all the validation errors, we know the type
	return payload as Export;
}

export function generateAPICalls(data: Buffer | string | object, options: ImportOptions): Query[] {
	const uExport = runBasicValidations(data);
	const uid = oid.generate();
	const queries: Query[] = [];

	validateUser(uExport.user);

	const {
		maxCoursesPerSemester = 7,
		maxCategoriesPerCourse = 25,
		maxGradesPerCategory = 40,
		gid
	} = options;

	queries.push(['user', {id: uid, gid, ...uExport.user}]);

	const semesters = new Map<string, number>();

	if (!Array.isArray(uExport.courses)) {
		return queries;
	}

	for (let i = 0; i < uExport.courses.length; ++i) {
		const course = uExport.courses[i];
		const ref = `.[${i}]`;

		let coursesInSemester = semesters.get(course.semester) || 0;

		if (++coursesInSemester > maxCoursesPerSemester) {
			throw new ValidationError({message: `Semester ${course.semester} has too many courses`});
		}

		semesters.set(course.semester, coursesInSemester);

		if (course.categories?.length > maxCategoriesPerCourse) {
			throw new ValidationError({message: `Course ${ref} has too many categories`});
		}

		queries.push(...generateCourseQuery(ref, uid, course, maxGradesPerCategory));
	}

	return queries;
}

export default generateAPICalls;
